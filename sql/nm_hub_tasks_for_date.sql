-- =============================================================================
-- NOTMID — Día de la tarea (for_date) en nm_hub_tasks
-- Ejecutar en SQL Editor si la tabla ya existía sin esta columna.
-- =============================================================================

ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS for_date date;

UPDATE public.nm_hub_tasks
SET for_date = (created_at AT TIME ZONE 'UTC')::date
WHERE for_date IS NULL;

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN for_date SET NOT NULL;

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN for_date SET DEFAULT (CURRENT_DATE);

CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_for_date ON public.nm_hub_tasks (for_date);

COMMENT ON COLUMN public.nm_hub_tasks.for_date IS 'Día calendario (taller) al que pertenece la tarea; el cliente filtra y crea por este campo.';
