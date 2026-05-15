-- =============================================================================
-- NOTMID — Realtime en lista de tareas (/tareas)
-- Ejecutar en SQL Editor si las tareas no se actualizan solas entre dispositivos
-- (nueva tarea, Completar, Descompletar, edición del mismo día).
-- =============================================================================

-- INSERT/UPDATE/DELETE en Realtime: hace falta la fila completa (p. ej. executed_at al completar).
ALTER TABLE public.nm_hub_tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.nm_hub_tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
