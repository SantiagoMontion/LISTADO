-- Vigilancia de tendencias (admin-only / Montion)
-- Corré este archivo completo en Supabase → SQL Editor.

create or replace function public.is_hub_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select trim(lower(p.role::text)) = 'admin'
      from public.nm_hub_profiles p
      where p.id = auth.uid()
      limit 1
    ),
    false
  );
$$;

revoke all on function public.is_hub_admin() from public;
grant execute on function public.is_hub_admin() to authenticated;
grant execute on function public.is_hub_admin() to service_role;

-- Catálogo de fuentes
create table if not exists public.trend_sources (
  id text primary key,
  label text not null,
  daily_budget int not null default 200,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Tareas de búsqueda (nichos)
create table if not exists public.trend_search_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  niche text not null default '',
  config jsonb not null default '{}'::jsonb,
  schedule_minutes int not null default 30,
  is_active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trend_search_tasks_active_idx
  on public.trend_search_tasks (is_active, last_run_at);

-- Items crudos
create table if not exists public.trend_raw_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.trend_search_tasks(id) on delete cascade,
  source text not null references public.trend_sources(id),
  external_id text not null,
  url text,
  title text not null default '',
  body text not null default '',
  author text,
  published_at timestamptz,
  media jsonb not null default '[]'::jsonb,
  engagement jsonb not null default '{}'::jsonb,
  content_hash text not null,
  raw_json jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists trend_raw_items_task_fetched_idx
  on public.trend_raw_items (task_id, fetched_at desc);
create index if not exists trend_raw_items_content_hash_idx
  on public.trend_raw_items (content_hash);
create index if not exists trend_raw_items_source_fetched_idx
  on public.trend_raw_items (source, fetched_at desc);

-- Análisis IA / heurístico
create table if not exists public.trend_analyzed_items (
  id uuid primary key default gen_random_uuid(),
  raw_item_id uuid not null unique references public.trend_raw_items(id) on delete cascade,
  task_id uuid not null references public.trend_search_tasks(id) on delete cascade,
  relevance int not null default 0,
  sentiment text not null default 'neutral',
  virality_score int not null default 0,
  impact_summary text not null default '',
  keywords text[] not null default '{}',
  entities text[] not null default '{}',
  signal_type text[] not null default '{}',
  product_angle text,
  content_angle text,
  is_emerging boolean not null default false,
  confidence numeric not null default 0,
  language text not null default 'other',
  analysis_json jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz not null default now()
);

create index if not exists trend_analyzed_items_task_score_idx
  on public.trend_analyzed_items (task_id, virality_score desc, analyzed_at desc);
create index if not exists trend_analyzed_items_emerging_idx
  on public.trend_analyzed_items (is_emerging, analyzed_at desc)
  where is_emerging = true;

-- Clusters cross-source (fase 2 light)
create table if not exists public.trend_clusters (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.trend_search_tasks(id) on delete cascade,
  label text not null default '',
  fingerprint text not null,
  item_count int not null default 1,
  max_virality int not null default 0,
  sources text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (task_id, fingerprint)
);

create index if not exists trend_clusters_task_virality_idx
  on public.trend_clusters (task_id, max_virality desc, last_seen_at desc);

-- Alertas
create table if not exists public.trend_alerts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.trend_search_tasks(id) on delete cascade,
  analyzed_item_id uuid references public.trend_analyzed_items(id) on delete set null,
  cluster_id uuid references public.trend_clusters(id) on delete set null,
  severity text not null default 'info',
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists trend_alerts_unread_idx
  on public.trend_alerts (is_read, created_at desc);

-- Cuotas diarias por fuente
create table if not exists public.trend_quota_usage (
  source_id text not null references public.trend_sources(id) on delete cascade,
  usage_date date not null default ((timezone('utc', now()))::date),
  used_count int not null default 0,
  primary key (source_id, usage_date)
);

-- Runs log
create table if not exists public.trend_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'cron',
  status text not null default 'running',
  summary jsonb not null default '{}'::jsonb
);

-- Seeds de fuentes
insert into public.trend_sources (id, label, daily_budget, is_enabled) values
  ('reddit', 'Reddit', 500, true),
  ('youtube', 'YouTube', 80, true),
  ('rss', 'RSS / News', 400, true),
  ('gtrends_rss', 'Google Trends RSS', 120, true),
  ('hn', 'Hacker News', 300, true),
  ('bluesky', 'Bluesky', 300, true),
  ('wikipedia', 'Wikipedia Pageviews', 100, true),
  ('lobsters', 'Lobsters', 100, true),
  ('mastodon', 'Mastodon', 100, false),
  ('arxiv', 'arXiv', 80, true)
on conflict (id) do nothing;

-- Tareas iniciales
insert into public.trend_search_tasks (name, niche, schedule_minutes, config)
select * from (values
  (
    'Gaming',
    'gaming',
    30,
    '{
      "keywords": ["gaming", "game release", "nintendo", "playstation", "xbox", "steam deck", "indie game"],
      "subreddits": ["gaming", "Games", "pcgaming", "nintendo", "PS5"],
      "youtube_channel_ids": [],
      "rss_feeds": [
        "https://news.google.com/rss/search?q=gaming+OR+videogames&hl=es-419&gl=AR&ceid=AR:es-419",
        "https://www.ign.com/rss/articles/feed"
      ],
      "trends_geos": ["AR", "US", "MX"],
      "bluesky_queries": ["gaming", "videogame"],
      "sources_enabled": ["reddit", "youtube", "rss", "gtrends_rss", "hn", "bluesky"]
    }'::jsonb
  ),
  (
    'Anime',
    'anime',
    30,
    '{
      "keywords": ["anime", "manga", "one piece", "demon slayer", "jujutsu kaisen", "studio ghibli"],
      "subreddits": ["anime", "manga", "Animesuggest"],
      "youtube_channel_ids": [],
      "rss_feeds": [
        "https://news.google.com/rss/search?q=anime+OR+manga&hl=es-419&gl=AR&ceid=AR:es-419"
      ],
      "trends_geos": ["AR", "US", "JP", "MX"],
      "bluesky_queries": ["anime", "manga"],
      "sources_enabled": ["reddit", "youtube", "rss", "gtrends_rss", "bluesky"]
    }'::jsonb
  ),
  (
    'IA',
    'ai',
    30,
    '{
      "keywords": ["AI", "ChatGPT", "LLM", "OpenAI", "Claude", "Gemini", "artificial intelligence"],
      "subreddits": ["MachineLearning", "LocalLLaMA", "ArtificialInteligence", "OpenAI"],
      "youtube_channel_ids": [],
      "rss_feeds": [
        "https://news.google.com/rss/search?q=artificial+intelligence+OR+ChatGPT+OR+LLM&hl=en-US&gl=US&ceid=US:en",
        "https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT"
      ],
      "trends_geos": ["US", "AR"],
      "bluesky_queries": ["AI", "LLM", "ChatGPT"],
      "sources_enabled": ["reddit", "youtube", "rss", "gtrends_rss", "hn", "bluesky", "arxiv"]
    }'::jsonb
  )
) as v(name, niche, schedule_minutes, config)
where not exists (select 1 from public.trend_search_tasks limit 1);

-- RLS
alter table public.trend_sources enable row level security;
alter table public.trend_search_tasks enable row level security;
alter table public.trend_raw_items enable row level security;
alter table public.trend_analyzed_items enable row level security;
alter table public.trend_clusters enable row level security;
alter table public.trend_alerts enable row level security;
alter table public.trend_quota_usage enable row level security;
alter table public.trend_runs enable row level security;

drop policy if exists "trend_sources_admin_all" on public.trend_sources;
create policy "trend_sources_admin_all"
  on public.trend_sources for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

drop policy if exists "trend_search_tasks_admin_all" on public.trend_search_tasks;
create policy "trend_search_tasks_admin_all"
  on public.trend_search_tasks for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

drop policy if exists "trend_raw_items_admin_all" on public.trend_raw_items;
create policy "trend_raw_items_admin_all"
  on public.trend_raw_items for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

drop policy if exists "trend_analyzed_items_admin_all" on public.trend_analyzed_items;
create policy "trend_analyzed_items_admin_all"
  on public.trend_analyzed_items for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

drop policy if exists "trend_clusters_admin_all" on public.trend_clusters;
create policy "trend_clusters_admin_all"
  on public.trend_clusters for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

drop policy if exists "trend_alerts_admin_all" on public.trend_alerts;
create policy "trend_alerts_admin_all"
  on public.trend_alerts for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

drop policy if exists "trend_quota_usage_admin_all" on public.trend_quota_usage;
create policy "trend_quota_usage_admin_all"
  on public.trend_quota_usage for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

drop policy if exists "trend_runs_admin_all" on public.trend_runs;
create policy "trend_runs_admin_all"
  on public.trend_runs for all to authenticated
  using (public.is_hub_admin())
  with check (public.is_hub_admin());

grant select, insert, update, delete on table
  public.trend_sources,
  public.trend_search_tasks,
  public.trend_raw_items,
  public.trend_analyzed_items,
  public.trend_clusters,
  public.trend_alerts,
  public.trend_quota_usage,
  public.trend_runs
to authenticated;

grant all on table
  public.trend_sources,
  public.trend_search_tasks,
  public.trend_raw_items,
  public.trend_analyzed_items,
  public.trend_clusters,
  public.trend_alerts,
  public.trend_quota_usage,
  public.trend_runs
to service_role;
