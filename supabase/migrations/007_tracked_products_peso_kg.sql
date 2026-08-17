-- Peso del paquete (kg) usado al cotizar → necesario para re-sync de precios ARS
ALTER TABLE public.tracked_products
  ADD COLUMN IF NOT EXISTS peso_kg NUMERIC NULL;

COMMENT ON COLUMN public.tracked_products.peso_kg IS
  'Peso paquete kg al crear (Aerobox). Sirve para recalcular precio ARS por variante en sync.';
