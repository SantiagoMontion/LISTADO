-- Limpia las 3 búsquedas seed (Gaming/Anime/IA) para arrancar con búsquedas manuales.
-- NO borra fuentes ni esquema. Corré en SQL Editor si querés empezar vacío.

delete from public.trend_search_tasks
where name in ('Gaming', 'Anime', 'IA');
