-- =============================================================================
-- NOTMID Producción — tablas AISLADAS (prefijo nm_prod_)
-- No modifica tablas existentes. Ejecutar en el SQL Editor de Supabase o como migración.
-- =============================================================================

-- Extensiones (uuid); en Supabase suele existir ya
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- nm_prod_reports: un reporte por día (o por carga)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nm_prod_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nm_prod_reports_fecha ON public.nm_prod_reports (fecha DESC);

-- -----------------------------------------------------------------------------
-- nm_prod_tasks: ítems por material dentro de un reporte
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nm_prod_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.nm_prod_reports (id) ON DELETE CASCADE,
  material_type text NOT NULL,
  dimensions text NOT NULL,
  total_qty integer NOT NULL CHECK (total_qty > 0),
  current_qty integer NOT NULL DEFAULT 0 CHECK (current_qty >= 0 AND current_qty <= total_qty),
  is_priority boolean NOT NULL DEFAULT false,
  notes text,
  is_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nm_prod_tasks_report_dim_unique UNIQUE (report_id, material_type, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_nm_prod_tasks_report ON public.nm_prod_tasks (report_id);
CREATE INDEX IF NOT EXISTS idx_nm_prod_tasks_material ON public.nm_prod_tasks (report_id, material_type);

-- Mantener is_completed alineado con contadores
CREATE OR REPLACE FUNCTION public.nm_prod_sync_task_completed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_completed := NEW.current_qty >= NEW.total_qty;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nm_prod_tasks_completed ON public.nm_prod_tasks;
CREATE TRIGGER trg_nm_prod_tasks_completed
  BEFORE INSERT OR UPDATE OF current_qty, total_qty ON public.nm_prod_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.nm_prod_sync_task_completed();

-- -----------------------------------------------------------------------------
-- Row Level Security (ajusta políticas si usas auth propia)
-- -----------------------------------------------------------------------------
ALTER TABLE public.nm_prod_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nm_prod_tasks ENABLE ROW LEVEL SECURITY;

-- Políticas permisivas para taller interno con anon key protegida.
-- Endurecer en producción (auth por rol, service role solo en backend, etc.).
DROP POLICY IF EXISTS nm_prod_reports_all_authenticated ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_all_authenticated
  ON public.nm_prod_reports
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS nm_prod_reports_all_anon ON public.nm_prod_reports;
CREATE POLICY nm_prod_reports_all_anon
  ON public.nm_prod_reports
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS nm_prod_tasks_all_authenticated ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_all_authenticated
  ON public.nm_prod_tasks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS nm_prod_tasks_all_anon ON public.nm_prod_tasks;
CREATE POLICY nm_prod_tasks_all_anon
  ON public.nm_prod_tasks
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Realtime: cambios visibles en todos los clientes
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.nm_prod_tasks;

-- Si la tabla ya estaba en la publicación, Supabase puede errorar; en ese caso omitir esta línea.
