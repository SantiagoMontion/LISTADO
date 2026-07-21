-- =============================================================================
-- NOTMID — Clientes mayoristas (registro para tareas hub Mayorista / Canje)
--
-- CUÁNDO: después de sql/nm_hub_tasks_assigned_admin.sql (usa nm_hub_profile_role)
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nm_hub_mayorista_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (char_length(trim(full_name)) > 0),
  dni text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nm_hub_mayorista_clients IS
  'Clientes mayoristas recordados para autocompletar en tareas hub.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_nm_hub_mayorista_clients_name_ci
  ON public.nm_hub_mayorista_clients (lower(trim(full_name)));

CREATE INDEX IF NOT EXISTS idx_nm_hub_mayorista_clients_name
  ON public.nm_hub_mayorista_clients (full_name);

CREATE OR REPLACE FUNCTION public.nm_hub_mayorista_clients_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nm_hub_mayorista_clients_touch ON public.nm_hub_mayorista_clients;
CREATE TRIGGER trg_nm_hub_mayorista_clients_touch
  BEFORE UPDATE ON public.nm_hub_mayorista_clients
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_mayorista_clients_touch_updated_at();

CREATE OR REPLACE FUNCTION public.nm_hub_can_manage_mayorista_clients()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN ('admin', 'lista_creator', 'taller_1', 'online_1');
$$;

ALTER TABLE public.nm_hub_mayorista_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_hub_mayorista_clients_select ON public.nm_hub_mayorista_clients;
CREATE POLICY nm_hub_mayorista_clients_select
  ON public.nm_hub_mayorista_clients
  FOR SELECT
  TO authenticated
  USING (public.nm_hub_can_manage_mayorista_clients());

DROP POLICY IF EXISTS nm_hub_mayorista_clients_insert ON public.nm_hub_mayorista_clients;
CREATE POLICY nm_hub_mayorista_clients_insert
  ON public.nm_hub_mayorista_clients
  FOR INSERT
  TO authenticated
  WITH CHECK (public.nm_hub_can_manage_mayorista_clients());

DROP POLICY IF EXISTS nm_hub_mayorista_clients_update ON public.nm_hub_mayorista_clients;
CREATE POLICY nm_hub_mayorista_clients_update
  ON public.nm_hub_mayorista_clients
  FOR UPDATE
  TO authenticated
  USING (public.nm_hub_can_manage_mayorista_clients())
  WITH CHECK (public.nm_hub_can_manage_mayorista_clients());

GRANT SELECT, INSERT, UPDATE ON public.nm_hub_mayorista_clients TO authenticated;
