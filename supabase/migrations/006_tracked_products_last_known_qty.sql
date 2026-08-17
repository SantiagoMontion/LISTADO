-- Snapshot de stock del último chequeo (para TTL de re-sync)
ALTER TABLE public.tracked_products
  ADD COLUMN IF NOT EXISTS last_known_qty INTEGER NULL;

COMMENT ON COLUMN public.tracked_products.last_known_qty IS
  'Cantidad mínima entre variantes tras el último sync. <5 = chequear seguido; >=5 = hasta ~2h.';
