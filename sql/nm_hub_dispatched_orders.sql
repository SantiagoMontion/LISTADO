-- =============================================================================
-- NOTMID — Pedidos despachados (conteo por día)
--
-- CUÁNDO: después de nm_hub_tasks_assigned_admin.sql (usa nm_hub_profile_role)
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
--
-- • admin y taller_1: leen el conteo de cualquier día
-- • solo admin: fija el total con nm_hub_set_dispatched(for_date, count)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nm_hub_dispatched_orders (
  for_date date PRIMARY KEY,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.nm_hub_profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.nm_hub_dispatched_orders IS
  'Pedidos despachados por día de calendario (hub).';

CREATE OR REPLACE FUNCTION public.nm_hub_dispatched_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nm_hub_dispatched_touch ON public.nm_hub_dispatched_orders;
CREATE TRIGGER trg_nm_hub_dispatched_touch
  BEFORE UPDATE ON public.nm_hub_dispatched_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_dispatched_touch_updated_at();

CREATE OR REPLACE FUNCTION public.nm_hub_can_view_dispatched_orders()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN ('admin', 'taller_1');
$$;

CREATE OR REPLACE FUNCTION public.nm_hub_set_dispatched(p_for_date date, p_count integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
  out_count integer;
BEGIN
  r := public.nm_hub_profile_role();
  IF r IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo administración puede registrar pedidos despachados'
      USING ERRCODE = '42501';
  END IF;

  IF p_for_date IS NULL THEN
    RAISE EXCEPTION 'for_date requerido' USING ERRCODE = '22023';
  END IF;

  IF p_count IS NULL OR p_count < 0 THEN
    RAISE EXCEPTION 'count debe ser >= 0' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.nm_hub_dispatched_orders (for_date, count, updated_by)
  VALUES (p_for_date, p_count, auth.uid())
  ON CONFLICT (for_date) DO UPDATE
    SET count = EXCLUDED.count,
        updated_by = auth.uid()
  RETURNING count INTO out_count;

  RETURN out_count;
END;
$$;

ALTER TABLE public.nm_hub_dispatched_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_hub_dispatched_select ON public.nm_hub_dispatched_orders;
CREATE POLICY nm_hub_dispatched_select
  ON public.nm_hub_dispatched_orders
  FOR SELECT
  TO authenticated
  USING (public.nm_hub_can_view_dispatched_orders());

GRANT SELECT ON public.nm_hub_dispatched_orders TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_hub_set_dispatched(date, integer) TO authenticated;
