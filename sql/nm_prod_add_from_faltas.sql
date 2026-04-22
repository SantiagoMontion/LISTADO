-- Ejecutar una vez en Supabase SQL Editor si la tabla ya existía sin `from_faltas`.
-- Permite la misma medida + material dos veces: lista principal (from_faltas = false) y LISTA FALTAS (true).

ALTER TABLE public.nm_prod_tasks DROP CONSTRAINT IF EXISTS nm_prod_tasks_report_dim_unique;

ALTER TABLE public.nm_prod_tasks
  ADD COLUMN IF NOT EXISTS from_faltas boolean NOT NULL DEFAULT false;

ALTER TABLE public.nm_prod_tasks DROP CONSTRAINT IF EXISTS nm_prod_tasks_report_dim_faltas_unique;

ALTER TABLE public.nm_prod_tasks
  ADD CONSTRAINT nm_prod_tasks_report_dim_faltas_unique
  UNIQUE (report_id, material_type, dimensions, from_faltas);
