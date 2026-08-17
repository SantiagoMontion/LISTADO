-- Reportes de auditoría de stock Importados (cron / hub)
create table if not exists public.importados_stock_audits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report jsonb not null
);

create index if not exists importados_stock_audits_created_at_idx
  on public.importados_stock_audits (created_at desc);

alter table public.importados_stock_audits enable row level security;

-- Lectura para usuarios autenticados del hub
drop policy if exists "importados_stock_audits_select_authenticated" on public.importados_stock_audits;
create policy "importados_stock_audits_select_authenticated"
  on public.importados_stock_audits
  for select
  to authenticated
  using (true);

-- Escritura solo service role (cron / API server)
