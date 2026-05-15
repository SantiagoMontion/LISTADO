-- =============================================================================
-- NOTMID — perfil por usuario (nombre visible + rol), ligado a auth.users
-- Ejecutar en el SQL Editor de Supabase después de nm_hub_schema.sql (recomendado).
-- Roles: creador_lista | taller_1 | taller_2
--   creador_lista: solo sube listas de producción (/creador); ve tareas en solo lectura.
--   taller_1: todo excepto subir lista de corte; crea y edita tareas del hub.
--   taller_2: solo ve lista de corte y tareas (sin crear).
-- El rol se edita en Table Editor / SQL como postgres (auth.uid() nulo en trigger).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- (nm_hub_profile_role() se define en sql/nm_workshop_roles_rls.sql, después de existir esta tabla.)

-- -----------------------------------------------------------------------------
-- Tabla
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nm_hub_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(trim(display_name)) > 0),
  role text NOT NULL DEFAULT 'taller_1'
    CHECK (role IN ('creador_lista', 'taller_1', 'taller_2')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nm_hub_profiles_role ON public.nm_hub_profiles (role);

CREATE OR REPLACE FUNCTION public.nm_hub_profiles_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nm_hub_profiles_updated ON public.nm_hub_profiles;
CREATE TRIGGER trg_nm_hub_profiles_updated
  BEFORE UPDATE ON public.nm_hub_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_profiles_touch_updated_at();

CREATE OR REPLACE FUNCTION public.nm_hub_profiles_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'El rol solo se puede cambiar desde el panel de Supabase (Table Editor / SQL).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nm_hub_profiles_guard ON public.nm_hub_profiles;
CREATE TRIGGER trg_nm_hub_profiles_guard
  BEFORE UPDATE ON public.nm_hub_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_profiles_guard_update();

-- -----------------------------------------------------------------------------
-- Alta automática al crear usuario en Auth
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nm_hub_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dn text;
BEGIN
  dn := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Usuario'
  );

  INSERT INTO public.nm_hub_profiles (id, display_name, role)
  VALUES (NEW.id, dn, 'taller_1')
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_nm_hub ON auth.users;
CREATE TRIGGER on_auth_user_created_nm_hub
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_handle_new_user();

-- -----------------------------------------------------------------------------
-- RLS perfiles
-- -----------------------------------------------------------------------------
ALTER TABLE public.nm_hub_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_hub_profiles_select ON public.nm_hub_profiles;
CREATE POLICY nm_hub_profiles_select
  ON public.nm_hub_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS nm_hub_profiles_update_own ON public.nm_hub_profiles;
CREATE POLICY nm_hub_profiles_update_own
  ON public.nm_hub_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS nm_hub_profiles_update_admin ON public.nm_hub_profiles;

GRANT SELECT, UPDATE ON public.nm_hub_profiles TO authenticated;

-- -----------------------------------------------------------------------------
-- Backfill usuarios Auth sin fila
-- -----------------------------------------------------------------------------
INSERT INTO public.nm_hub_profiles (id, display_name, role)
SELECT
  u.id,
  COALESCE(
    NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(u.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
    'Usuario'
  ),
  'taller_1'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.nm_hub_profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Siguiente paso: sql/nm_workshop_roles_rls.sql (incluye nm_hub_profile_role() + RLS listas/tareas).

