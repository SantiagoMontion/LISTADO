-- =============================================================================
-- NOTMID — Asignación de tareas del hub a un usuario (opcional)
-- Ejecutar DESPUÉS de sql/nm_hub_schema.sql (tabla nm_hub_tasks ya existe).
-- NULL = sin asignar (podés tratarlo como “para todos” en la UI).
-- La app debe guardar/leer assigned_to (uuid = auth.users.id).
-- =============================================================================

ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_assigned_to ON public.nm_hub_tasks (assigned_to);

COMMENT ON COLUMN public.nm_hub_tasks.assigned_to IS 'Usuario al que se asigna la tarea; NULL si no aplica o equipo completo.';

-- Si más adelante querés RLS por asignación (ej. cada uno solo ve las suyas),
-- habría que ajustar las políticas de nm_hub_tasks en nm_workshop_roles_rls.sql
-- (hoy taller_1 puede todo; creador_lista / taller_2 leen según lo que definamos).
