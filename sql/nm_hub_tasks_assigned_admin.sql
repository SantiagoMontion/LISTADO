-- =============================================================================
-- NOTMID — FIX RLS tareas + assigned_role 'admin' + crear/borrar vía RPC
--
-- Ejecutá TODO este archivo en Supabase → SQL Editor → Run.
-- "No rows returned" en ALTER/CREATE = OK. Al final debés ver políticas + constraint.
-- =============================================================================

-- 1) Constraint
ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_assigned_role_check;
ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_assigned_role_check
  CHECK (assigned_role IN ('online_1', 'taller_1', 'lista_creator', 'admin'));

-- 2) Helpers (SECURITY DEFINER = leen perfil sin depender de RLS)
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

-- 3) Crear tarea (evita error RLS en INSERT … RETURNING del cliente)
CREATE OR REPLACE FUNCTION public.nm_hub_create_task(
  p_title text,
  p_body text,
  p_importance text,
  p_for_date date,
  p_assigned_role text,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS public.nm_hub_tasks
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

  RETURN out_row;
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_create_task(text, text, text, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_create_task(text, text, text, date, text, uuid) TO authenticated;

-- 4) Eliminar tarea — solo admin
CREATE OR REPLACE FUNCTION public.nm_hub_delete_task(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.nm_hub_profile_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede eliminar tareas.'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.nm_hub_tasks WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_delete_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_delete_task(uuid) TO authenticated;

-- 5) Políticas RLS (borra duplicadas)
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

-- =============================================================================
-- Diagnóstico (debe listar 4 políticas; constraint con 'admin')
-- =============================================================================
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'nm_hub_tasks'
ORDER BY policyname;

SELECT pg_get_constraintdef(oid) AS assigned_role_check
FROM pg_constraint
WHERE conrelid = 'public.nm_hub_tasks'::regclass
  AND conname = 'nm_hub_tasks_assigned_role_check';
