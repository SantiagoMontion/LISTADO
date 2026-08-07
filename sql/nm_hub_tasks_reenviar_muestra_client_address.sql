-- =============================================================================
-- NOTMID — Tipos de tarea reenviar/muestra + CP y ciudad en clientes
--
-- CUÁNDO: después de sql/nm_hub_tasks_workflow_payment.sql
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
-- =============================================================================

-- Clientes: código postal y ciudad (obligatorios en la UI al cargar datos)
ALTER TABLE public.nm_hub_mayorista_clients
  ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '';

ALTER TABLE public.nm_hub_mayorista_clients
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.nm_hub_mayorista_clients.postal_code IS
  'Código postal del domicilio del cliente.';

COMMENT ON COLUMN public.nm_hub_mayorista_clients.city IS
  'Ciudad / localidad del domicilio del cliente.';

-- Tipos de tarea nuevos
ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_task_type_check;

ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_task_type_check
  CHECK (
    task_type IS NULL
    OR task_type IN (
      'falta',
      'mayorista',
      'rehacer',
      'canje',
      'devolucion',
      'reenviar',
      'muestra'
    )
  );

COMMENT ON COLUMN public.nm_hub_tasks.task_type IS
  'Tipo de tarea hub: falta, mayorista, rehacer, canje, devolucion, reenviar, muestra.';

-- RPC create_task: aceptar los nuevos tipos (misma firma que workflow_payment)
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
  IF type_norm IS NOT NULL AND type_norm NOT IN (
    'falta',
    'mayorista',
    'rehacer',
    'canje',
    'devolucion',
    'reenviar',
    'muestra'
  ) THEN
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
