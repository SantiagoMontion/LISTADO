-- =============================================================================
-- NOTMID — Añadir familia «faltas» a imágenes de material (ya desplegado)
-- Ejecutar UNA VEZ en SQL Editor si ya corriste nm_prod_material_images.sql sin faltas.
-- =============================================================================

ALTER TABLE public.nm_prod_material_images
  DROP CONSTRAINT IF EXISTS nm_prod_material_images_material_family_check;

ALTER TABLE public.nm_prod_material_images
  ADD CONSTRAINT nm_prod_material_images_material_family_check
  CHECK (material_family IN ('classic', 'pro', 'ultra', 'alfombra', 'faltas'));
