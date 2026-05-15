-- =============================================================================
-- NOTMID — Roles RBAC en nm_hub_profiles (admin, lista_creator, taller_1, taller_2)
-- Ejecutar en SQL Editor. Migra creador_lista → lista_creator.
-- =============================================================================

ALTER TABLE public.nm_hub_profiles DROP CONSTRAINT IF EXISTS nm_hub_profiles_role_check;

UPDATE public.nm_hub_profiles SET role = 'lista_creator' WHERE role = 'creador_lista';
UPDATE public.nm_hub_profiles SET role = 'taller_1' WHERE role = 'operario';
UPDATE public.nm_hub_profiles SET role = 'taller_2' WHERE role = 'vista';
UPDATE public.nm_hub_profiles SET role = 'taller_1'
  WHERE role NOT IN ('admin', 'lista_creator', 'taller_1', 'taller_2');

ALTER TABLE public.nm_hub_profiles
  ADD CONSTRAINT nm_hub_profiles_role_check
  CHECK (role IN ('admin', 'lista_creator', 'taller_1', 'taller_2'));

COMMENT ON COLUMN public.nm_hub_profiles.role IS
  'admin: todo | lista_creator: subir/ver lista | taller_1: tareas y archivos | taller_2: solo lista de corte';
