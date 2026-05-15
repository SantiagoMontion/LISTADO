-- =============================================================================
-- NOTMID — Migración: roles de taller + RLS en nm_prod_* y nm_hub_tasks/storage
--
-- ⚠️ PREREQUISITO: la tabla public.nm_hub_profiles debe existir.
--    Ejecutá PRIMERO (en este orden): sql/nm_hub_profiles.sql → luego ESTE archivo.
--    Si saltaste nm_hub_profiles.sql por el error de cuota, corrélo ahora y después este.
--
-- Ejecutar UNA VEZ en SQL Editor. Crea nm_hub_profile_role(). Migra valores de role viejos.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.nm_hub_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT trim(lower(p.role))
  FROM public.nm_hub_profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

-- Rol en perfiles (si venías de admin/operario/vista u otra constraint vieja)
ALTER TABLE public.nm_hub_profiles DROP CONSTRAINT IF EXISTS nm_hub_profiles_role_check;

UPDATE public.nm_hub_profiles SET role = 'taller_1' WHERE role IN ('admin', 'operario');
UPDATE public.nm_hub_profiles SET role = 'taller_2' WHERE role = 'vista';
UPDATE public.nm_hub_profiles SET role = 'taller_1' WHERE role NOT IN ('creador_lista', 'taller_1', 'taller_2');

ALTER TABLE public.nm_hub_profiles
  ADD CONSTRAINT nm_hub_profiles_role_check CHECK (role IN ('creador_lista', 'taller_1', 'taller_2'));

-- Trigger / función de perfil (alineado con repo actual)
CREATE OR REPLACE FUNCTION public.nm_hub_profiles_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'El rol solo se puede cambiar desde el panel de Supabase (Table Editor / SQL).';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nm_hub_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dn text;
BEGIN
  dn := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Usuario'
  );

  INSERT INTO public.nm_hub_profiles (id, display_name, role)
  VALUES (NEW.id, dn, 'taller_1')
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS nm_hub_profiles_select ON public.nm_hub_profiles;
CREATE POLICY nm_hub_profiles_select
  ON public.nm_hub_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS nm_hub_profiles_update_admin ON public.nm_hub_profiles;

DROP FUNCTION IF EXISTS public.nm_hub_is_admin();

-- -----------------------------------------------------------------------------
-- nm_prod: reemplazar políticas permisivas de authenticated
-- (DROP de *_auth permite re-ejecutar este archivo sin error 42710.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS nm_prod_reports_all_authenticated ON public.nm_prod_reports;
DROP POLICY IF EXISTS nm_prod_reports_select_auth ON public.nm_prod_reports;
DROP POLICY IF EXISTS nm_prod_reports_insert_auth ON public.nm_prod_reports;
DROP POLICY IF EXISTS nm_prod_reports_update_auth ON public.nm_prod_reports;
DROP POLICY IF EXISTS nm_prod_reports_delete_auth ON public.nm_prod_reports;

DROP POLICY IF EXISTS nm_prod_tasks_all_authenticated ON public.nm_prod_tasks;
DROP POLICY IF EXISTS nm_prod_tasks_select_auth ON public.nm_prod_tasks;
DROP POLICY IF EXISTS nm_prod_tasks_insert_auth ON public.nm_prod_tasks;
DROP POLICY IF EXISTS nm_prod_tasks_update_auth ON public.nm_prod_tasks;
DROP POLICY IF EXISTS nm_prod_tasks_delete_auth ON public.nm_prod_tasks;

CREATE POLICY nm_prod_reports_select_auth
  ON public.nm_prod_reports FOR SELECT TO authenticated USING (true);

CREATE POLICY nm_prod_reports_insert_auth
  ON public.nm_prod_reports FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_profile_role() = 'creador_lista');

CREATE POLICY nm_prod_reports_update_auth
  ON public.nm_prod_reports FOR UPDATE TO authenticated
  USING (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1'))
  WITH CHECK (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1'));

CREATE POLICY nm_prod_reports_delete_auth
  ON public.nm_prod_reports FOR DELETE TO authenticated
  USING (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1'));

CREATE POLICY nm_prod_tasks_select_auth
  ON public.nm_prod_tasks FOR SELECT TO authenticated USING (true);

CREATE POLICY nm_prod_tasks_insert_auth
  ON public.nm_prod_tasks FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1'));

CREATE POLICY nm_prod_tasks_update_auth
  ON public.nm_prod_tasks FOR UPDATE TO authenticated
  USING (public.nm_hub_profile_role() = 'taller_1')
  WITH CHECK (public.nm_hub_profile_role() = 'taller_1');

CREATE POLICY nm_prod_tasks_delete_auth
  ON public.nm_prod_tasks FOR DELETE TO authenticated
  USING (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1'));

-- -----------------------------------------------------------------------------
-- nm_hub_tasks + storage (solo taller_1 escribe)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS nm_hub_tasks_select ON public.nm_hub_tasks;
DROP POLICY IF EXISTS nm_hub_tasks_insert ON public.nm_hub_tasks;
DROP POLICY IF EXISTS nm_hub_tasks_update ON public.nm_hub_tasks;
DROP POLICY IF EXISTS nm_hub_tasks_delete ON public.nm_hub_tasks;

CREATE POLICY nm_hub_tasks_select
  ON public.nm_hub_tasks FOR SELECT TO authenticated USING (true);

CREATE POLICY nm_hub_tasks_insert
  ON public.nm_hub_tasks FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_profile_role() = 'taller_1');

CREATE POLICY nm_hub_tasks_update
  ON public.nm_hub_tasks FOR UPDATE TO authenticated
  USING (public.nm_hub_profile_role() = 'taller_1')
  WITH CHECK (public.nm_hub_profile_role() = 'taller_1');

CREATE POLICY nm_hub_tasks_delete
  ON public.nm_hub_tasks FOR DELETE TO authenticated
  USING (public.nm_hub_profile_role() = 'taller_1');

DROP POLICY IF EXISTS nm_hub_storage_select ON storage.objects;
DROP POLICY IF EXISTS nm_hub_storage_insert ON storage.objects;
DROP POLICY IF EXISTS nm_hub_storage_update ON storage.objects;
DROP POLICY IF EXISTS nm_hub_storage_delete ON storage.objects;

CREATE POLICY nm_hub_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nm-hub-task-images');

CREATE POLICY nm_hub_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nm-hub-task-images'
    AND public.nm_hub_profile_role() = 'taller_1'
  );

CREATE POLICY nm_hub_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'nm-hub-task-images' AND public.nm_hub_profile_role() = 'taller_1');

CREATE POLICY nm_hub_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nm-hub-task-images' AND public.nm_hub_profile_role() = 'taller_1');
