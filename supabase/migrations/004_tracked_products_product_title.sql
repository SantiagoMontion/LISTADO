-- Nombre visible del producto en la lista de sync
ALTER TABLE public.tracked_products
  ADD COLUMN IF NOT EXISTS product_title TEXT NULL;

COMMENT ON COLUMN public.tracked_products.product_title IS
  'Título del producto en el proveedor (para mostrar en la UI en lugar del URL)';
