-- =============================================================================
-- NOTMID — Imágenes de referencia por material y día (lista de corte)
-- Ejecutar en SQL Editor después de nm_prod_schema.sql y nm_workshop_roles_rls.sql
-- (requiere nm_hub_profile_role()).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nm_prod_material_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  material_family text NOT NULL CHECK (material_family IN ('classic', 'pro', 'ultra', 'alfombra')),
  storage_path text NOT NULL,
  original_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nm_prod_material_images_fecha ON public.nm_prod_material_images (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_nm_prod_material_images_fecha_family ON public.nm_prod_material_images (fecha, material_family);

ALTER TABLE public.nm_prod_material_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_prod_material_images_select_auth ON public.nm_prod_material_images;
CREATE POLICY nm_prod_material_images_select_auth
  ON public.nm_prod_material_images FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS nm_prod_material_images_insert_auth ON public.nm_prod_material_images;
CREATE POLICY nm_prod_material_images_insert_auth
  ON public.nm_prod_material_images FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_profile_role() = 'creador_lista');

-- Bucket privado (objetos con URL firmada desde la app)
INSERT INTO storage.buckets (id, name, public)
VALUES ('nm-prod-material-images', 'nm-prod-material-images', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS nm_prod_material_storage_select ON storage.objects;
DROP POLICY IF EXISTS nm_prod_material_storage_insert ON storage.objects;

CREATE POLICY nm_prod_material_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nm-prod-material-images');

CREATE POLICY nm_prod_material_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nm-prod-material-images'
    AND public.nm_hub_profile_role() = 'creador_lista'
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.nm_prod_material_images;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
