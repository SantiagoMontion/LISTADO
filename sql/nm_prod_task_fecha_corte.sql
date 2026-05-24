-- =============================================================================
-- NOTMID — Fecha real de corte (+) y eventos para analítica admin
-- Ejecutar después de nm_prod_schema.sql y nm_prod_admin_lista_permissions.sql
-- =============================================================================

ALTER TABLE public.nm_prod_tasks
  ADD COLUMN IF NOT EXISTS fecha_corte timestamptz;

COMMENT ON COLUMN public.nm_prod_tasks.fecha_corte IS
  'Última unidad cortada (+). created_at = alta de línea; report.fecha = día de lista.';

CREATE TABLE IF NOT EXISTS public.nm_prod_task_cut_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.nm_prod_tasks (id) ON DELETE CASCADE,
  cut_at timestamptz NOT NULL DEFAULT now(),
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_nm_prod_task_cut_events_cut_at
  ON public.nm_prod_task_cut_events (cut_at DESC);

CREATE INDEX IF NOT EXISTS idx_nm_prod_task_cut_events_task_id
  ON public.nm_prod_task_cut_events (task_id);

COMMENT ON TABLE public.nm_prod_task_cut_events IS
  'Un registro por pulsación (+): volumen de corte por timestamp real.';

ALTER TABLE public.nm_prod_task_cut_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_prod_task_cut_events_select ON public.nm_prod_task_cut_events;
CREATE POLICY nm_prod_task_cut_events_select
  ON public.nm_prod_task_cut_events
  FOR SELECT
  TO authenticated
  USING (public.nm_hub_profile_role() = 'admin');

GRANT SELECT ON public.nm_prod_task_cut_events TO authenticated;

-- -----------------------------------------------------------------------------
-- RPC: +1 unidad + evento + fecha_corte
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nm_prod_increment_task_qty(p_task_id uuid)
RETURNS public.nm_prod_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out public.nm_prod_tasks;
  v_now timestamptz := now();
BEGIN
  IF NOT public.nm_prod_can_edit_cut_list() THEN
    RAISE EXCEPTION 'Sin permiso para editar la lista de corte' USING ERRCODE = '42501';
  END IF;

  UPDATE public.nm_prod_tasks t
  SET
    current_qty = t.current_qty + 1,
    fecha_corte = v_now
  WHERE t.id = p_task_id
    AND t.current_qty < t.total_qty
  RETURNING * INTO out;

  IF out.id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.nm_prod_task_cut_events (task_id, cut_at, qty)
  VALUES (p_task_id, v_now, 1);

  RETURN out;
END;
$$;

-- -----------------------------------------------------------------------------
-- RPC: completar línea (✂) — registra un evento por unidad restante
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nm_prod_finish_task_qty(p_task_id uuid)
RETURNS public.nm_prod_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out public.nm_prod_tasks;
  v_now timestamptz := now();
  v_remaining integer;
  i integer;
BEGIN
  IF NOT public.nm_prod_can_edit_cut_list() THEN
    RAISE EXCEPTION 'Sin permiso para editar la lista de corte' USING ERRCODE = '42501';
  END IF;

  SELECT greatest(t.total_qty - t.current_qty, 0)
  INTO v_remaining
  FROM public.nm_prod_tasks t
  WHERE t.id = p_task_id;

  IF v_remaining IS NULL THEN
    RETURN NULL;
  END IF;

  FOR i IN 1..v_remaining LOOP
    INSERT INTO public.nm_prod_task_cut_events (task_id, cut_at, qty)
    VALUES (p_task_id, v_now, 1);
  END LOOP;

  UPDATE public.nm_prod_tasks t
  SET
    current_qty = t.total_qty,
    fecha_corte = v_now
  WHERE t.id = p_task_id
  RETURNING * INTO out;

  RETURN out;
END;
$$;

-- Decremento: quita el último evento si existe
CREATE OR REPLACE FUNCTION public.nm_prod_decrement_task_qty(p_task_id uuid)
RETURNS public.nm_prod_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out public.nm_prod_tasks;
  v_event_id uuid;
BEGIN
  IF NOT public.nm_prod_can_edit_cut_list() THEN
    RAISE EXCEPTION 'Sin permiso para editar la lista de corte' USING ERRCODE = '42501';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.nm_prod_task_cut_events e
  WHERE e.task_id = p_task_id
  ORDER BY e.cut_at DESC, e.id DESC
  LIMIT 1;

  IF v_event_id IS NOT NULL THEN
    DELETE FROM public.nm_prod_task_cut_events WHERE id = v_event_id;
  END IF;

  UPDATE public.nm_prod_tasks t
  SET
    current_qty = t.current_qty - 1,
    is_completed = false,
    fecha_corte = (
      SELECT max(e.cut_at) FROM public.nm_prod_task_cut_events e WHERE e.task_id = p_task_id
    )
  WHERE t.id = p_task_id
    AND t.current_qty > 0
  RETURNING * INTO out;

  RETURN out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nm_prod_finish_task_qty(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.nm_prod_restore_task_qty(p_task_id uuid)
RETURNS public.nm_prod_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out public.nm_prod_tasks;
BEGIN
  IF NOT public.nm_prod_can_edit_cut_list() THEN
    RAISE EXCEPTION 'Sin permiso para editar la lista de corte' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.nm_prod_task_cut_events WHERE task_id = p_task_id;

  UPDATE public.nm_prod_tasks t
  SET current_qty = 0, is_completed = false, fecha_corte = NULL
  WHERE t.id = p_task_id
  RETURNING * INTO out;

  RETURN out;
END;
$$;
