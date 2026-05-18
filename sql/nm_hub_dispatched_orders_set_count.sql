-- NOTMID — Pedidos despachados: fijar total del día (en lugar de +1)
-- Ejecutar si ya corriste nm_hub_dispatched_orders.sql con nm_hub_increment_dispatched.

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

GRANT EXECUTE ON FUNCTION public.nm_hub_set_dispatched(date, integer) TO authenticated;
