-- =============================================================================
-- NOTMID — Tareas completadas visibles para todos los roles del hub
--
-- CUÁNDO: después de sql/nm_hub_tasks_assigned_admin.sql
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
-- =============================================================================

CREATE OR REPLACE FUNCTION public.nm_hub_can_view_hub_tasks()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN ('admin', 'lista_creator', 'taller_1', 'taller_2', 'online_1');
$$;

GRANT EXECUTE ON FUNCTION public.nm_hub_can_view_hub_tasks() TO authenticated;

DROP POLICY IF EXISTS nm_hub_tasks_select ON public.nm_hub_tasks;

CREATE POLICY nm_hub_tasks_select
  ON public.nm_hub_tasks
  FOR SELECT
  TO authenticated
  USING (
    (executed_at IS NOT NULL AND public.nm_hub_can_view_hub_tasks())
    OR public.nm_hub_task_row_visible(assigned_role, created_by)
  );
