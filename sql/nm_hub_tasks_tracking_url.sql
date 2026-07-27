-- =============================================================================
-- NOTMID — Link de seguimiento en tareas hub
-- Supabase → SQL Editor → Run
-- =============================================================================

ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS tracking_url text;

COMMENT ON COLUMN public.nm_hub_tasks.tracking_url IS
  'URL de seguimiento (ej. Andreani) para tareas completadas.';

CREATE OR REPLACE FUNCTION public.nm_hub_set_task_tracking_url(
  p_task_id uuid,
  p_tracking_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_row public.nm_hub_tasks;
  url_norm text;
BEGIN
  IF public.nm_hub_profile_role() NOT IN (
    'admin',
    'lista_creator',
    'taller_1',
    'taller_2',
    'online_1'
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para cargar el seguimiento.' USING ERRCODE = '42501';
  END IF;

  url_norm := nullif(trim(coalesce(p_tracking_url, '')), '');

  UPDATE public.nm_hub_tasks
  SET tracking_url = url_norm
  WHERE id = p_task_id
  RETURNING * INTO out_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarea no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(out_row);
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_set_task_tracking_url(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_set_task_tracking_url(uuid, text) TO authenticated;
