-- =============================================================================
-- NOTMID — Imágenes en notas de tarea del hub
-- Ejecutar después de sql/nm_hub_task_notes.sql
-- Usa el bucket existente nm-hub-task-images (ruta notes/{task_id}/…).
-- =============================================================================

ALTER TABLE public.nm_hub_task_notes
  ADD COLUMN IF NOT EXISTS image_paths text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.nm_hub_task_notes.image_paths IS
  'Rutas en storage (bucket nm-hub-task-images) bajo notes/{task_id}/.';

ALTER TABLE public.nm_hub_task_notes
  DROP CONSTRAINT IF EXISTS nm_hub_task_notes_body_check;

ALTER TABLE public.nm_hub_task_notes
  ADD CONSTRAINT nm_hub_task_notes_body_check
  CHECK (
    char_length(body) <= 8000
    AND (
      char_length(trim(body)) > 0
      OR coalesce(cardinality(image_paths), 0) > 0
    )
  );

-- Editar texto: sigue habiendo texto o la nota conserva imágenes
DROP POLICY IF EXISTS nm_hub_task_notes_update ON public.nm_hub_task_notes;
CREATE POLICY nm_hub_task_notes_update
  ON public.nm_hub_task_notes FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid()
    AND public.nm_hub_task_note_task_visible(task_id)
  )
  WITH CHECK (
    author_id = auth.uid()
    AND public.nm_hub_task_note_task_visible(task_id)
    AND char_length(body) <= 8000
    AND (
      char_length(trim(body)) > 0
      OR coalesce(cardinality(image_paths), 0) > 0
    )
  );
