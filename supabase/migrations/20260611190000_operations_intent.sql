-- PR9: Intent sözleşmesi — her operasyona amaç, yararlanıcı ve kısıtlar ekleniyor.
-- Adlandırma: 20260611* tarih damgası + açıklayıcı son ek (0027 ve 20260609* deseni).
--
-- Kural: kolon eklemeden önce mevcut operations şeması doğrulandı (20260611140000_operations.sql):
--   id, owner_user_id, goal_text, domain_pack, persona, model, risk, status,
--   max_steps, step_count, cooldown_minutes, last_tick_at, context_json, created_at, updated_at
-- intent_json JSONB NULL → eski operasyonlar NULL = kısıt yok (geriye uyumluluk).

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS intent_json JSONB NULL;

COMMENT ON COLUMN public.operations.intent_json IS
  'PR9 intent sözleşmesi: {beneficiary, success_criteria, forbidden_tools?, forbidden_topics?, max_total_spend?, expires_at?}. NULL = kısıt yok.';

-- intent.contract_schema: POST /api/operations ve portal formunun dinamik doğrulama kaynağı.
-- Yarın "bütçe alanını da zorunlu yap" demek için deploy değil, Politikalar sayfası yeterli.
-- Şema JSON Schema Draft-7 formatında; required[] dizisi zorunlu alan listesini belirler.
INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT
  NULL,
  'intent.contract_schema',
  '{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["beneficiary", "success_criteria"],
    "properties": {
      "beneficiary":       { "type": "string", "minLength": 1 },
      "success_criteria":  { "type": "string", "minLength": 1 },
      "forbidden_tools":   { "type": "array",  "items": { "type": "string" } },
      "forbidden_topics":  { "type": "array",  "items": { "type": "string" } },
      "max_total_spend":   { "type": "number", "minimum": 0 },
      "expires_at":        { "type": "string", "format": "date-time" }
    },
    "additionalProperties": false
  }'::jsonb,
  'PR9: Operasyon intent sözleşmesi JSON Schema (Draft-7). required[] dizisi POST /api/operations zorunlu alanlarını belirler. Politikalar sayfasından güncellenebilir.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings WHERE key = 'intent.contract_schema' AND owner_user_id IS NULL
);

NOTIFY pgrst, 'reload schema';
