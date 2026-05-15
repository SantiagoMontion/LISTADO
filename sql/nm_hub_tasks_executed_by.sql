-- =============================================================================
-- NOTMID Hub — quién completó la tarea (executed_by → auth.users)
-- Ejecutar en SQL Editor del mismo proyecto Supabase.
-- =============================================================================

ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS executed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.nm_hub_tasks.executed_by IS 'Usuario que marcó la tarea como hecha; se limpia al desmarcar.';

CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_executed_by ON public.nm_hub_tasks (executed_by)
  WHERE executed_by IS NOT NULL;
