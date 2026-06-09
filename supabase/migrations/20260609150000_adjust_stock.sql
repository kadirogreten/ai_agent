-- Onaylı satın alma sonrası stok yenileme RPC'si.
-- purchase_order tool'u (insan onayından sonra) bunu çağırır: stock_levels.current_stock += delta.
-- Böylece tedarik döngüsü kapanır — stok eşik üstüne çıkar, izleyici aynı ürünü yeniden tetiklemez.
-- Ürün eşleşmesi büyük/küçük harf duyarsız (ILIKE), çünkü sipariş ürün adı ("Kırmızı Kalem")
-- stok satırından ("kırmızı kalem") farklı yazılmış olabilir.

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_owner   UUID,
  p_product TEXT,
  p_delta   INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new INTEGER;
BEGIN
  UPDATE public.stock_levels
  SET current_stock = current_stock + p_delta,
      updated_at    = now()
  WHERE owner_user_id = p_owner
    AND product ILIKE p_product
  RETURNING current_stock INTO v_new;

  RETURN v_new;  -- eşleşen satır yoksa NULL
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_stock TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_stock TO authenticated;
