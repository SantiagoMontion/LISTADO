-- =============================================================================
-- NOTMID — Permitir eliminar tareas a quienes crean tareas hub
--
-- CUÁNDO: después de sql/nm_hub_tasks_completed_visible_all.sql
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
-- =============================================================================

CREATE OR REPLACE FUNCTION public.nm_hub_delete_task(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.nm_hub_profile_role() NOT IN ('admin', 'lista_creator', 'taller_1', 'online_1') THEN
    RAISE EXCEPTION 'No tenés permiso para eliminar tareas.'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.nm_hub_tasks WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_delete_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_delete_task(uuid) TO authenticated;
