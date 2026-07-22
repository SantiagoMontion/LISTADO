-- =============================================================================
-- NOTMID — Estado de flujo y pago en tareas hub
--
-- CUÁNDO: después de sql/nm_hub_tasks_task_type.sql
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
-- =============================================================================

ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS workflow_status text;

ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS payment_status text;

UPDATE public.nm_hub_tasks
SET workflow_status = 'sin_ingresar'
WHERE workflow_status IS NULL;

UPDATE public.nm_hub_tasks
SET payment_status = 'sin_pagar'
WHERE payment_status IS NULL;

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN workflow_status SET DEFAULT 'sin_ingresar';

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN payment_status SET DEFAULT 'sin_pagar';

ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_workflow_status_check;
ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_workflow_status_check
  CHECK (workflow_status IN ('enviado', 'listo', 'fabricacion', 'sin_ingresar'));

ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_payment_status_check;
ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_payment_status_check
  CHECK (payment_status IN ('pago', 'sin_pagar'));

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN workflow_status SET NOT NULL;

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN payment_status SET NOT NULL;

COMMENT ON COLUMN public.nm_hub_tasks.workflow_status IS
  'Estado operativo: enviado | listo | fabricacion | sin_ingresar';

COMMENT ON COLUMN public.nm_hub_tasks.payment_status IS
  'Estado de pago: pago | sin_pagar';

DROP FUNCTION IF EXISTS public.nm_hub_create_task(text, text, text, date, text, uuid, text);

CREATE FUNCTION public.nm_hub_create_task(
  p_title text,
  p_body text,
  p_importance text,
  p_for_date date,
  p_assigned_role text,
  p_assigned_to uuid DEFAULT NULL,
  p_task_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_row public.nm_hub_tasks;
  role_norm text;
  type_norm text;
BEGIN
  role_norm := trim(lower(coalesce(p_assigned_role, '')));
  IF NOT public.nm_hub_task_insert_allowed(role_norm) THEN
    RAISE EXCEPTION 'No tenés permiso para crear esta tarea (rol %).', role_norm
      USING ERRCODE = '42501';
  END IF;

  type_norm := nullif(trim(lower(coalesce(p_task_type, ''))), '');
  IF type_norm IS NOT NULL AND type_norm NOT IN ('falta', 'mayorista', 'rehacer', 'canje', 'devolucion') THEN
    RAISE EXCEPTION 'task_type inválido: %', type_norm USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.nm_hub_tasks (
    title,
    body,
    importance,
    for_date,
    assigned_role,
    assigned_to,
    due_at,
    image_paths,
    task_type,
    workflow_status,
    payment_status
  )
  VALUES (
    trim(p_title),
    nullif(trim(coalesce(p_body, '')), ''),
    coalesce(nullif(trim(p_importance), ''), 'normal'),
    p_for_date,
    role_norm,
    p_assigned_to,
    NULL,
    '{}'::text[],
    type_norm,
    'sin_ingresar',
    'sin_pagar'
  )
  RETURNING * INTO out_row;

  RETURN to_jsonb(out_row);
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_create_task(text, text, text, date, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_create_task(text, text, text, date, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.nm_hub_set_task_workflow_status(
  p_task_id uuid,
  p_workflow_status text
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
  status_norm := trim(lower(coalesce(p_workflow_status, '')));
  IF status_norm NOT IN ('enviado', 'listo', 'fabricacion', 'sin_ingresar') THEN
    RAISE EXCEPTION 'workflow_status inválido: %', status_norm USING ERRCODE = '22023';
  END IF;

  IF public.nm_hub_profile_role() NOT IN ('admin', 'lista_creator', 'taller_1', 'online_1') THEN
    RAISE EXCEPTION 'No tenés permiso para cambiar el estado.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.nm_hub_tasks
  SET workflow_status = status_norm
  WHERE id = p_task_id
  RETURNING * INTO out_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarea no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(out_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.nm_hub_set_task_payment_status(
  p_task_id uuid,
  p_payment_status text
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
  status_norm := trim(lower(coalesce(p_payment_status, '')));
  IF status_norm NOT IN ('pago', 'sin_pagar') THEN
    RAISE EXCEPTION 'payment_status inválido: %', status_norm USING ERRCODE = '22023';
  END IF;

  IF public.nm_hub_profile_role() NOT IN ('admin', 'lista_creator', 'taller_1', 'online_1') THEN
    RAISE EXCEPTION 'No tenés permiso para cambiar el pago.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.nm_hub_tasks
  SET payment_status = status_norm
  WHERE id = p_task_id
  RETURNING * INTO out_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarea no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(out_row);
END;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_set_task_workflow_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_set_task_workflow_status(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.nm_hub_set_task_payment_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_set_task_payment_status(uuid, text) TO authenticated;
