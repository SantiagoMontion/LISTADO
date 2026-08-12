-- Limpia alertas/resultados basura previos (inflación en Gaming, etc.)
-- Opcional. No borra tus búsquedas (trend_search_tasks).

delete from public.trend_alerts;
delete from public.trend_analyzed_items;
delete from public.trend_raw_items;
delete from public.trend_clusters;
delete from public.trend_runs;
