-- Ventas de importados (precio cobrado vs costo unitario) para ganancias por mes.
create table if not exists public.importados_sales (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null,
  shopify_line_item_id text not null unique,
  shopify_order_name text not null,
  shopify_variant_id text null,
  tracked_product_id uuid null,
  supplier_variant_id text null,
  provider text null,
  title text not null,
  variant_title text null,
  quantity integer not null,
  unit_price_ars numeric not null default 0,
  revenue_ars numeric not null default 0,
  cost_usd numeric null,
  peso_kg numeric null,
  unit_cost_ars numeric null,
  cost_ars numeric null,
  profit_ars numeric null,
  dolar_mep numeric null,
  paid_at timestamptz not null,
  month date not null,
  created_at timestamptz not null default now()
);

create index if not exists importados_sales_month_idx
  on public.importados_sales (month desc, paid_at desc);

create index if not exists importados_sales_paid_at_idx
  on public.importados_sales (paid_at desc);

alter table public.importados_sales enable row level security;

drop policy if exists "importados_sales_select_authenticated" on public.importados_sales;
create policy "importados_sales_select_authenticated"
  on public.importados_sales
  for select
  to authenticated
  using (true);
