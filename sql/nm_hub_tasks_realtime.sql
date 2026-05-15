-- =============================================================================
-- NOTMID — Realtime en lista de tareas (/tareas)
-- Ejecutar en SQL Editor si las tareas no se actualizan solas entre dispositivos.
-- =============================================================================

-- Filtros Realtime en UPDATE/DELETE necesitan la fila completa en el WAL.
ALTER TABLE public.nm_hub_tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.nm_hub_tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
