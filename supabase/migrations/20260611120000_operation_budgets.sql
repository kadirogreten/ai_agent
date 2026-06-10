-- Güvenlik kilidi 2: Bütçe kilidi.
-- operation_budgets: araç çağrısı başına tutar + sayı limiti.
-- consume_budget RPC: atomik check-and-increment (yarış koşulu yok, period rollover dahil).
--
-- Adlandırma: mevcut tarih-damgalı düzen. Örnek: 20260609120000_tedarik_stock_levels.sql
-- RLS deseni: 0019_domain_packs.sql ve 004_approval_queue.sql'i izler.

-- ── Tablo ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operation_budgets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope          TEXT        NOT NULL,          -- araç slug'ı veya 'global'
  period         TEXT        NOT NULL DEFAULT 'daily'
                             CHECK (period IN ('daily','weekly','monthly')),
  max_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 0 = limit yok
  max_tool_calls INT           NOT NULL DEFAULT 0,  -- 0 = limit yok
  spent_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  used_calls     INT           NOT NULL DEFAULT 0,
  period_start   DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, scope, period, period_start)
);

COMMENT ON TABLE public.operation_budgets IS
  'Araç başına veya global otomasyon bütçesi. consume_budget RPC atomik olarak kontrol eder ve artırır.';
COMMENT ON COLUMN public.operation_budgets.scope IS
  'Araç slug (purchase_order) veya "global". BudgetChecker scope=slug ile sorgular.';
COMMENT ON COLUMN public.operation_budgets.period_start IS
  'Dönem başlangıcı; consume_budget bu tarih eski ise yeni satır upsert eder (rollover).';

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.operation_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY ob_select_own ON public.operation_budgets
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY ob_service_role_all ON public.operation_budgets
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON TABLE public.operation_budgets TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.operation_budgets TO service_role;

-- ── İndeksler ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ob_owner_scope
  ON public.operation_budgets(owner_user_id, scope, period, period_start DESC);

-- ── consume_budget RPC ───────────────────────────────────────────────────────
-- Atomik check-and-increment: eski dönem satırı varsa yeni dönem için upsert eder,
-- sonra limitleri kontrol eder, izin varsa spent_amount ve used_calls'u artırır.
-- Dönüş: JSON {"allowed": true/false, "reason": "..."}
CREATE OR REPLACE FUNCTION public.consume_budget(
  p_owner  UUID,
  p_scope  TEXT,
  p_amount NUMERIC DEFAULT 0,
  p_calls  INT     DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start  DATE;
  v_period        TEXT;
  v_max_amount    NUMERIC(14,2);
  v_max_calls     INT;
  v_spent         NUMERIC(14,2);
  v_calls         INT;
  v_row_id        UUID;
BEGIN
  -- Bu scope için herhangi bir bütçe satırı var mı?
  SELECT id, period, max_amount, max_tool_calls, spent_amount, used_calls, period_start
    INTO v_row_id, v_period, v_max_amount, v_max_calls, v_spent, v_calls, v_period_start
    FROM public.operation_budgets
   WHERE owner_user_id = p_owner
     AND scope = p_scope
   ORDER BY period_start DESC
   LIMIT 1;

  -- Satır yoksa: limit tanımlanmamış → izin ver, sayacı artırma.
  IF NOT FOUND THEN
    RETURN '{"allowed": true, "reason": "no_budget_defined"}'::jsonb;
  END IF;

  -- Dönem kontrolü: period_start eski ise yeni dönem başlat (rollover).
  v_period_start := CASE v_period
    WHEN 'daily'   THEN CURRENT_DATE
    WHEN 'weekly'  THEN date_trunc('week',  CURRENT_DATE)::date
    WHEN 'monthly' THEN date_trunc('month', CURRENT_DATE)::date
    ELSE CURRENT_DATE
  END;

  IF (SELECT period_start FROM public.operation_budgets WHERE id = v_row_id) <> v_period_start THEN
    -- Yeni dönem: spent_amount ve used_calls sıfırlanır.
    INSERT INTO public.operation_budgets
      (owner_user_id, scope, period, max_amount, max_tool_calls, spent_amount, used_calls, period_start)
    VALUES
      (p_owner, p_scope, v_period, v_max_amount, v_max_calls, 0, 0, v_period_start)
    ON CONFLICT (owner_user_id, scope, period, period_start) DO NOTHING;

    v_spent  := 0;
    v_calls  := 0;
  END IF;

  -- Limit kontrolleri (0 = limit yok).
  IF v_max_amount > 0 AND (v_spent + p_amount) > v_max_amount THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'amount_limit_exceeded',
      'spent',   v_spent,
      'limit',   v_max_amount
    );
  END IF;

  IF v_max_calls > 0 AND (v_calls + p_calls) > v_max_calls THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'call_limit_exceeded',
      'used',    v_calls,
      'limit',   v_max_calls
    );
  END IF;

  -- İzin var: atomik artır.
  UPDATE public.operation_budgets
     SET spent_amount = spent_amount + p_amount,
         used_calls   = used_calls   + p_calls,
         updated_at   = now()
   WHERE owner_user_id = p_owner
     AND scope = p_scope
     AND period_start = v_period_start;

  RETURN '{"allowed": true, "reason": "ok"}'::jsonb;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_budget(UUID, TEXT, NUMERIC, INT) TO service_role;

COMMENT ON FUNCTION public.consume_budget IS
  'Atomik bütçe kontrolü + artırma. Yarış koşulu yok. BudgetChecker sadece bunu çağırır.';
