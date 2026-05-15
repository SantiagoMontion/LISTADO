-- =============================================================================
-- NOTMID — Taller 2: permisos completos en lista de corte + updates atómicos
-- Ejecutar en SQL Editor después de nm_workshop_roles_rls.sql
-- =============================================================================

-- RLS: Taller 2 puede marcar cortes, agregar líneas y borrar listas (como Taller 1 en /manejador)
DROP POLICY IF EXISTS nm_prod_reports_insert_auth ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_insert_auth
  ON public.nm_prod_reports FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1', 'taller_2'));

DROP POLICY IF EXISTS nm_prod_reports_update_auth ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_update_auth
  ON public.nm_prod_reports FOR UPDATE TO authenticated
  USING (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1', 'taller_2'))
  WITH CHECK (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1', 'taller_2'));

DROP POLICY IF EXISTS nm_prod_reports_delete_auth ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_delete_auth
  ON public.nm_prod_reports FOR DELETE TO authenticated
  USING (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1', 'taller_2'));

DROP POLICY IF EXISTS nm_prod_tasks_insert_auth ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_insert_auth
  ON public.nm_prod_tasks FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1', 'taller_2'));

DROP POLICY IF EXISTS nm_prod_tasks_update_auth ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_update_auth
  ON public.nm_prod_tasks FOR UPDATE TO authenticated
  USING (public.nm_hub_profile_role() IN ('taller_1', 'taller_2'))
  WITH CHECK (public.nm_hub_profile_role() IN ('taller_1', 'taller_2'));

DROP POLICY IF EXISTS nm_prod_tasks_delete_auth ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_delete_auth
  ON public.nm_prod_tasks FOR DELETE TO authenticated
  USING (public.nm_hub_profile_role() IN ('creador_lista', 'taller_1', 'taller_2'));

-- -----------------------------------------------------------------------------
-- Cantidades: UPDATE atómico en servidor (varios usuarios en la misma lista)
-- El trigger trg_nm_prod_tasks_completed sigue sincronizando is_completed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nm_prod_assert_list_editor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.nm_hub_profile_role() NOT IN ('taller_1', 'taller_2') THEN
    RAISE EXCEPTION 'Sin permiso para editar la lista de corte';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.nm_prod_increment_task_qty(p_task_id uuid)
RETURNS public.nm_prod_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out public.nm_prod_tasks;
BEGIN
  PERFORM public.nm_prod_assert_list_editor();
  UPDATE public.nm_prod_tasks t
  SET current_qty = t.current_qty + 1
  WHERE t.id = p_task_id
    AND t.current_qty < t.total_qty
  RETURNING * INTO out;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.nm_prod_decrement_task_qty(p_task_id uuid)
RETURNS public.nm_prod_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out public.nm_prod_tasks;
BEGIN
  PERFORM public.nm_prod_assert_list_editor();
  UPDATE public.nm_prod_tasks t
  SET
    current_qty = t.current_qty - 1,
    is_completed = false
  WHERE t.id = p_task_id
    AND t.current_qty > 0
  RETURNING * INTO out;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.nm_prod_restore_task_qty(p_task_id uuid)
RETURNS public.nm_prod_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out public.nm_prod_tasks;
BEGIN
  PERFORM public.nm_prod_assert_list_editor();
  UPDATE public.nm_prod_tasks t
  SET current_qty = 0, is_completed = false
  WHERE t.id = p_task_id
  RETURNING * INTO out;
  RETURN out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nm_prod_assert_list_editor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_prod_increment_task_qty(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_prod_decrement_task_qty(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_prod_restore_task_qty(uuid) TO authenticated;
