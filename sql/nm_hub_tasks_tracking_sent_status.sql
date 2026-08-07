-- =============================================================================
-- NOTMID — Aviso de seguimiento al cliente (pendiente / enviado)
--
-- CUÁNDO: después de sql/nm_hub_tasks_tracking_url.sql
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
-- =============================================================================

ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS tracking_sent_status text;

UPDATE public.nm_hub_tasks
SET tracking_sent_status = 'pendiente'
WHERE tracking_sent_status IS NULL;

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN tracking_sent_status SET DEFAULT 'pendiente';

ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_tracking_sent_status_check;

ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_tracking_sent_status_check
  CHECK (tracking_sent_status IN ('pendiente', 'enviado'));

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN tracking_sent_status SET NOT NULL;

COMMENT ON COLUMN public.nm_hub_tasks.tracking_sent_status IS
  'Si se envió el link de seguimiento al cliente: pendiente | enviado.';

CREATE OR REPLACE FUNCTION public.nm_hub_set_task_tracking_sent_status(
  p_task_id uuid,
  p_tracking_sent_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_row public.nm_hub_tasks;
  status_norm text;
BEGIN
  status_norm := trim(lower(coalesce(p_tracking_sent_status, '')));
  IF status_norm NOT IN ('pendiente', 'enviado') THEN
    RAISE EXCEPTION 'tracking_sent_status inválido: %', status_norm USING ERRCODE = '22023';
  END IF;

  IF public.nm_hub_profile_role() NOT IN ('admin', 'lista_creator', 'taller_1', 'online_1') THEN
    RAISE EXCEPTION 'No tenés permiso para cambiar el aviso de seguimiento.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.nm_hub_tasks
  SET tracking_sent_status = status_norm
  WHERE id = p_task_id
  RETURNING * INTO out_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarea no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(out_row);
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_set_task_tracking_sent_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_set_task_tracking_sent_status(uuid, text) TO authenticated;
