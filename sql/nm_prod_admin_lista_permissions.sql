-- =============================================================================
-- NOTMID — Admin + lista_creator: subir lista de corte e imágenes de material
--
-- Ejecutar en SQL Editor después de:
--   nm_hub_profiles.sql → nm_workshop_roles_rls.sql → nm_hub_roles_rbac.sql
--   (y nm_prod_material_images.sql si usás imágenes)
--
-- El cliente (hubPermissions) ya permite admin; las políticas RLS viejas
-- solo aceptaban creador_lista / taller_* y bloqueaban admin y lista_creator.
-- =============================================================================

-- Asegura nm_hub_profile_role() normalizado (por si no corriste nm_hub_tasks_assigned_admin.sql)
CREATE OR REPLACE FUNCTION public.nm_hub_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT trim(lower(p.role::text))
  FROM public.nm_hub_profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_profile_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_profile_role() TO authenticated;

-- Roles que pueden pegar/subir lista completa (/creador)
CREATE OR REPLACE FUNCTION public.nm_prod_can_upload_list()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN (
    'admin',
    'lista_creator',
    'creador_lista'  -- legacy por si quedó algún perfil sin migrar
  );
$$;

-- Imágenes de referencia por material/día
CREATE OR REPLACE FUNCTION public.nm_prod_can_upload_material_images()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_prod_can_upload_list();
$$;

-- Editar cantidades / prioridad en /manejador (RPC + UPDATE directo)
CREATE OR REPLACE FUNCTION public.nm_prod_can_edit_cut_list()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN ('admin', 'taller_1', 'taller_2');
$$;

-- Borrar lista del día (+ líneas)
CREATE OR REPLACE FUNCTION public.nm_prod_can_delete_cut_list()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN ('admin', 'taller_2');
$$;

-- Insertar líneas / reportes desde manejador (taller agrega medidas)
CREATE OR REPLACE FUNCTION public.nm_prod_can_insert_cut_lines()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN (
    'admin',
    'lista_creator',
    'creador_lista',
    'taller_1',
    'taller_2'
  );
$$;

GRANT EXECUTE ON FUNCTION public.nm_prod_can_upload_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_prod_can_upload_material_images() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_prod_can_edit_cut_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_prod_can_delete_cut_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_prod_can_insert_cut_lines() TO authenticated;

-- -----------------------------------------------------------------------------
-- nm_prod_reports / nm_prod_tasks
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS nm_prod_reports_insert_auth ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_insert_auth
  ON public.nm_prod_reports FOR INSERT TO authenticated
  WITH CHECK (public.nm_prod_can_insert_cut_lines());

DROP POLICY IF EXISTS nm_prod_reports_update_auth ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_update_auth
  ON public.nm_prod_reports FOR UPDATE TO authenticated
  USING (public.nm_prod_can_insert_cut_lines())
  WITH CHECK (public.nm_prod_can_insert_cut_lines());

DROP POLICY IF EXISTS nm_prod_reports_delete_auth ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_delete_auth
  ON public.nm_prod_reports FOR DELETE TO authenticated
  USING (public.nm_prod_can_delete_cut_list());

DROP POLICY IF EXISTS nm_prod_tasks_insert_auth ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_insert_auth
  ON public.nm_prod_tasks FOR INSERT TO authenticated
  WITH CHECK (public.nm_prod_can_insert_cut_lines());

DROP POLICY IF EXISTS nm_prod_tasks_update_auth ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_update_auth
  ON public.nm_prod_tasks FOR UPDATE TO authenticated
  USING (public.nm_prod_can_edit_cut_list())
  WITH CHECK (public.nm_prod_can_edit_cut_list());

DROP POLICY IF EXISTS nm_prod_tasks_delete_auth ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_delete_auth
  ON public.nm_prod_tasks FOR DELETE TO authenticated
  USING (public.nm_prod_can_delete_cut_list());

-- RPC cantidades (nm_prod_taller2_list_permissions.sql)
CREATE OR REPLACE FUNCTION public.nm_prod_assert_list_editor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.nm_prod_can_edit_cut_list() THEN
    RAISE EXCEPTION 'Sin permiso para editar la lista de corte';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- nm_prod_material_images + storage
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS nm_prod_material_images_insert_auth ON public.nm_prod_material_images;
CREATE POLICY nm_prod_material_images_insert_auth
  ON public.nm_prod_material_images FOR INSERT TO authenticated
  WITH CHECK (public.nm_prod_can_upload_material_images());

DROP POLICY IF EXISTS nm_prod_material_storage_insert ON storage.objects;
CREATE POLICY nm_prod_material_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nm-prod-material-images'
    AND public.nm_prod_can_upload_material_images()
  );

-- -----------------------------------------------------------------------------
-- Verificación rápida (reemplazá el UUID por el tuyo en Authentication → Users)
-- -----------------------------------------------------------------------------
-- SELECT id, role FROM public.nm_hub_profiles WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
-- Debe ser role = 'admin'. Si no:
-- UPDATE public.nm_hub_profiles SET role = 'admin' WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
