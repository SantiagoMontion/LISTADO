-- =============================================================================
-- NOTMID — Configuración compartida de la calculadora 3D (singleton)
--
-- CUÁNDO: después de nm_hub_profiles.sql / nm_workshop_roles_rls.sql
-- CÓMO: Supabase → SQL Editor → pegar TODO → Run
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nm_hub_printing3d_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.nm_hub_printing3d_config IS
  'Config fija de impresora 3D compartida por todo el hub (una sola fila, id=1).';

INSERT INTO public.nm_hub_printing3d_config (id, config)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nm_hub_printing3d_config_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nm_hub_printing3d_config_touch ON public.nm_hub_printing3d_config;
CREATE TRIGGER trg_nm_hub_printing3d_config_touch
  BEFORE UPDATE ON public.nm_hub_printing3d_config
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_printing3d_config_touch_updated_at();

ALTER TABLE public.nm_hub_printing3d_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_hub_printing3d_config_select ON public.nm_hub_printing3d_config;
CREATE POLICY nm_hub_printing3d_config_select
  ON public.nm_hub_printing3d_config
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS nm_hub_printing3d_config_insert ON public.nm_hub_printing3d_config;
CREATE POLICY nm_hub_printing3d_config_insert
  ON public.nm_hub_printing3d_config
  FOR INSERT
  TO authenticated
  WITH CHECK (id = 1);

DROP POLICY IF EXISTS nm_hub_printing3d_config_update ON public.nm_hub_printing3d_config;
CREATE POLICY nm_hub_printing3d_config_update
  ON public.nm_hub_printing3d_config
  FOR UPDATE
  TO authenticated
  USING (id = 1)
  WITH CHECK (id = 1);

GRANT SELECT, INSERT, UPDATE ON public.nm_hub_printing3d_config TO authenticated;
