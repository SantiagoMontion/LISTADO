-- =============================================================================
-- NOTMID — Tareas hub: rol admin + RLS + RPC (crear / imágenes / borrar)
--
-- CUÁNDO: después de sql/nm_hub_online_1_roles_task_assign.sql
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run (una vez; re-ejecutar es seguro)
--
-- Qué hace:
--   • assigned_role puede ser 'admin' (solo admin puede asignarse a sí)
--   • nm_hub_create_task → jsonb (evita error falso "row-level security" al crear)
--   • nm_hub_delete_task → admin y taller_1
--   • Storage nm-hub-task-images para admin y creadores de tareas
--
-- Al final debés ver: 4 políticas en nm_hub_tasks, constraint con 'admin',
-- y 3 funciones (create, set_image_paths, delete).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Constraint assigned_role
-- -----------------------------------------------------------------------------
ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS assigned_role text;

ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_assigned_role_check;

ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_assigned_role_check
  CHECK (assigned_role IN ('online_1', 'taller_1', 'lista_creator', 'admin'));

COMMENT ON COLUMN public.nm_hub_tasks.assigned_role IS
  'Rol destino: online_1, taller_1, lista_creator, admin (bandeja del administrador).';

-- -----------------------------------------------------------------------------
-- 2) Helpers (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.nm_hub_task_insert_allowed(p_assigned_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
  a text;
BEGIN
  r := public.nm_hub_profile_role();
  a := trim(lower(coalesce(p_assigned_role, '')));
  IF r IS NULL OR r = '' THEN
    RETURN false;
  END IF;
  IF a IN ('online_1', 'taller_1', 'lista_creator') THEN
    RETURN r IN ('admin', 'lista_creator', 'taller_1', 'online_1');
  END IF;
  IF a = 'admin' THEN
    RETURN r = 'admin';
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.nm_hub_task_row_visible(
  p_assigned_role text,
  p_created_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  r := public.nm_hub_profile_role();
  IF r IS NULL OR r = '' THEN
    RETURN false;
  END IF;
  IF r = 'admin' THEN
    RETURN true;
  END IF;
  IF p_created_by IS NOT NULL AND p_created_by = auth.uid() THEN
    RETURN true;
  END IF;
  IF trim(lower(coalesce(p_assigned_role, ''))) = r THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_profile_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_profile_role() TO authenticated;
REVOKE ALL ON FUNCTION public.nm_hub_task_insert_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_task_insert_allowed(text) TO authenticated;
REVOKE ALL ON FUNCTION public.nm_hub_task_row_visible(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_task_row_visible(text, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) RPC: crear tarea (la app llama esto; devuelve jsonb, no fila con RLS)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.nm_hub_create_task(text, text, text, date, text, uuid);

CREATE FUNCTION public.nm_hub_create_task(
  p_title text,
  p_body text,
  p_importance text,
  p_for_date date,
  p_assigned_role text,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_row public.nm_hub_tasks;
  role_norm text;
BEGIN
  role_norm := trim(lower(coalesce(p_assigned_role, '')));
  IF NOT public.nm_hub_task_insert_allowed(role_norm) THEN
    RAISE EXCEPTION 'No tenés permiso para crear esta tarea (rol %).', role_norm
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.nm_hub_tasks (
    title,
    body,
    importance,
    for_date,
    assigned_role,
    assigned_to,
    due_at,
    image_paths
  )
  VALUES (
    trim(p_title),
    nullif(trim(coalesce(p_body, '')), ''),
    coalesce(nullif(trim(p_importance), ''), 'normal'),
    p_for_date,
    role_norm,
    p_assigned_to,
    NULL,
    '{}'::text[]
  )
  RETURNING * INTO out_row;

  RETURN to_jsonb(out_row);
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_create_task(text, text, text, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_create_task(text, text, text, date, text, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) RPC: actualizar image_paths (subida de fotos en tareas)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nm_hub_set_task_image_paths(
  p_task_id uuid,
  p_image_paths text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_row public.nm_hub_tasks;
BEGIN
  SELECT * INTO out_row FROM public.nm_hub_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarea no encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.nm_hub_task_row_visible(out_row.assigned_role, out_row.created_by) THEN
    RAISE EXCEPTION 'Sin permiso para editar esta tarea.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.nm_hub_tasks
  SET image_paths = coalesce(p_image_paths, '{}'::text[])
  WHERE id = p_task_id
  RETURNING * INTO out_row;

  RETURN to_jsonb(out_row);
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_set_task_image_paths(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_set_task_image_paths(uuid, text[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) RPC: eliminar tarea (admin y taller_1)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nm_hub_delete_task(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.nm_hub_profile_role() NOT IN ('admin', 'taller_1') THEN
    RAISE EXCEPTION 'No tenés permiso para eliminar tareas.'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.nm_hub_tasks WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_delete_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_delete_task(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) RLS nm_hub_tasks (borra políticas viejas / duplicadas)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol text;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nm_hub_tasks'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.nm_hub_tasks', pol);
  END LOOP;
END $$;

ALTER TABLE public.nm_hub_tasks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nm_hub_tasks TO authenticated;

CREATE POLICY nm_hub_tasks_select
  ON public.nm_hub_tasks FOR SELECT TO authenticated
  USING (public.nm_hub_task_row_visible(assigned_role, created_by));

CREATE POLICY nm_hub_tasks_insert
  ON public.nm_hub_tasks FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_task_insert_allowed(assigned_role));

CREATE POLICY nm_hub_tasks_update
  ON public.nm_hub_tasks FOR UPDATE TO authenticated
  USING (public.nm_hub_task_row_visible(assigned_role, created_by))
  WITH CHECK (public.nm_hub_task_insert_allowed(assigned_role));

CREATE POLICY nm_hub_tasks_delete
  ON public.nm_hub_tasks FOR DELETE TO authenticated
  USING (public.nm_hub_profile_role() = 'admin');

-- -----------------------------------------------------------------------------
-- 7) Storage: bucket imágenes de tareas
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('nm-hub-task-images', 'nm-hub-task-images', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

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
    AND public.nm_hub_profile_role() IN ('admin', 'lista_creator', 'taller_1', 'online_1')
  );

CREATE POLICY nm_hub_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'nm-hub-task-images'
    AND public.nm_hub_profile_role() IN ('admin', 'lista_creator', 'taller_1', 'online_1')
  );

CREATE POLICY nm_hub_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'nm-hub-task-images'
    AND public.nm_hub_profile_role() IN ('admin', 'lista_creator', 'taller_1', 'online_1')
  );

-- =============================================================================
-- 8) VERIFICACIÓN (deben devolver filas; si no, algo falló)
-- =============================================================================

-- 8a) Funciones RPC (esperado: 3 filas)
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'nm_hub_create_task',
    'nm_hub_set_task_image_paths',
    'nm_hub_delete_task'
  )
ORDER BY routine_name;

-- 8b) Políticas RLS (esperado: 4 filas)
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'nm_hub_tasks'
ORDER BY policyname;

-- 8c) Constraint (debe incluir 'admin')
SELECT pg_get_constraintdef(oid) AS assigned_role_check
FROM pg_constraint
WHERE conrelid = 'public.nm_hub_tasks'::regclass
  AND conname = 'nm_hub_tasks_assigned_role_check';

-- -----------------------------------------------------------------------------
-- Si tu usuario no es admin, actualizalo (reemplazá el UUID en Authentication → Users):
-- UPDATE public.nm_hub_profiles SET role = 'admin' WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
-- -----------------------------------------------------------------------------
