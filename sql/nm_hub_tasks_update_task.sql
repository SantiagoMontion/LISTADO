-- =============================================================================
-- NOTMID — Editar tarea hub (título, detalle, seguimiento)
-- Supabase → SQL Editor → Run
-- =============================================================================

CREATE OR REPLACE FUNCTION public.nm_hub_update_task(
  p_task_id uuid,
  p_title text,
  p_body text,
  p_tracking_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_row public.nm_hub_tasks;
  title_norm text;
  body_norm text;
  url_norm text;
BEGIN
  SELECT * INTO out_row FROM public.nm_hub_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarea no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.nm_hub_task_row_visible(out_row.assigned_role, out_row.created_by) THEN
    RAISE EXCEPTION 'Sin permiso para editar esta tarea.' USING ERRCODE = '42501';
  END IF;

  title_norm := trim(coalesce(p_title, ''));
  IF title_norm = '' THEN
    RAISE EXCEPTION 'El título no puede estar vacío.' USING ERRCODE = '22023';
  END IF;

  body_norm := nullif(trim(coalesce(p_body, '')), '');
  url_norm := nullif(trim(coalesce(p_tracking_url, '')), '');

  UPDATE public.nm_hub_tasks
  SET
    title = title_norm,
    body = body_norm,
    tracking_url = url_norm,
    updated_at = now()
  WHERE id = p_task_id
  RETURNING * INTO out_row;

  RETURN to_jsonb(out_row);
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_update_task(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_update_task(uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.nm_hub_update_task(uuid, text, text, text) IS
  'Actualiza título, detalle (body) y link de seguimiento de una tarea visible.';
