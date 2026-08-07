-- Variant mapping for multi-variant Shopify products created from sync
ALTER TABLE public.tracked_products
  ADD COLUMN IF NOT EXISTS notmid_shopify_product_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS variant_map JSONB NULL;

COMMENT ON COLUMN public.tracked_products.notmid_shopify_product_id IS
  'ID del producto creado en NotMid Shopify';
COMMENT ON COLUMN public.tracked_products.variant_map IS
  'Mapa [{supplierVariantId, option, notmidVariantId, sku}] para sync de stock por variante';
