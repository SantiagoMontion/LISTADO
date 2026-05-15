-- =============================================================================
-- NOTMID Hub — tareas de empresa + adjuntos en Storage (prefijo nm_hub_)
-- Ejecutar en el SQL Editor de Supabase (mismo proyecto que nm_prod_*).
-- =============================================================================
--
-- Sesiones largas (~meses): en Dashboard → Authentication → Sessions
-- ajustá "JWT expiry" y políticas de refresh según la doc actual de Supabase.
-- El cliente usa persistSession (localStorage) y refresca el access token solo.
--
-- Seguridad: desactivá "Sign ups" públicos y creá usuarios desde Authentication → Users,
-- o usá invitaciones. Las tablas nm_hub_* solo permiten `authenticated`, no `anon`.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- nm_hub_tasks: tareas con formulario rico (importancia, vencimiento, imágenes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nm_hub_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  body text,
  importance text NOT NULL DEFAULT 'normal'
    CHECK (importance IN ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  executed_at timestamptz,
  executed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  image_paths text[] NOT NULL DEFAULT '{}'::text[],
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  for_date date NOT NULL DEFAULT (CURRENT_DATE),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_executed ON public.nm_hub_tasks (executed_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_due ON public.nm_hub_tasks (due_at NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_importance ON public.nm_hub_tasks (importance);
CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_assigned_to ON public.nm_hub_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_for_date ON public.nm_hub_tasks (for_date);
CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_executed_by ON public.nm_hub_tasks (executed_by)
  WHERE executed_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.nm_hub_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nm_hub_set_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nm_hub_tasks_created_by ON public.nm_hub_tasks;
CREATE TRIGGER trg_nm_hub_tasks_created_by
  BEFORE INSERT ON public.nm_hub_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_set_created_by();

DROP TRIGGER IF EXISTS trg_nm_hub_tasks_updated ON public.nm_hub_tasks;
CREATE TRIGGER trg_nm_hub_tasks_updated
  BEFORE UPDATE ON public.nm_hub_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_hub_touch_updated_at();

ALTER TABLE public.nm_hub_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_hub_tasks_select ON public.nm_hub_tasks;
CREATE POLICY nm_hub_tasks_select
  ON public.nm_hub_tasks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS nm_hub_tasks_insert ON public.nm_hub_tasks;
CREATE POLICY nm_hub_tasks_insert
  ON public.nm_hub_tasks FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS nm_hub_tasks_update ON public.nm_hub_tasks;
CREATE POLICY nm_hub_tasks_update
  ON public.nm_hub_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS nm_hub_tasks_delete ON public.nm_hub_tasks;
CREATE POLICY nm_hub_tasks_delete
  ON public.nm_hub_tasks FOR DELETE TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- Storage: bucket privado para imágenes de tareas
-- Rutas sugeridas: {task_id}/{nombre-archivo}  (el cliente sube así)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('nm-hub-task-images', 'nm-hub-task-images', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Políticas de objetos: solo usuarios autenticados del mismo proyecto
DROP POLICY IF EXISTS nm_hub_storage_select ON storage.objects;
CREATE POLICY nm_hub_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nm-hub-task-images');

DROP POLICY IF EXISTS nm_hub_storage_insert ON storage.objects;
CREATE POLICY nm_hub_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nm-hub-task-images');

DROP POLICY IF EXISTS nm_hub_storage_update ON storage.objects;
CREATE POLICY nm_hub_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'nm-hub-task-images');

DROP POLICY IF EXISTS nm_hub_storage_delete ON storage.objects;
CREATE POLICY nm_hub_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nm-hub-task-images');

-- Realtime (opcional): si falla porque ya está en la publicación, ignorar
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.nm_hub_tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
