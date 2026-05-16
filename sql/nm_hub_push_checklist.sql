-- =============================================================================
-- NOTMID — Checklist push (diagnóstico si no llegan avisos al celular)
-- Ejecutar en SQL Editor. Reemplazá emails/UUIDs según tu caso.
-- =============================================================================

-- 1) ¿Hay suscripciones guardadas? (debe haber al menos 1 fila por celular que activó avisos)
SELECT
  s.user_id,
  p.display_name,
  p.role,
  left(s.endpoint, 48) AS endpoint_preview,
  s.updated_at
FROM public.nm_hub_push_subscriptions s
LEFT JOIN public.nm_hub_profiles p ON p.id = s.user_id
ORDER BY s.updated_at DESC;

-- 2) ¿Realtime en tareas? (para aviso con app abierta)
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'nm_hub_tasks';

-- Si no devuelve fila, ejecutar: sql/nm_hub_tasks_realtime.sql

-- 3) Últimas tareas creadas (ver assigned_role y created_by)
SELECT id, title, assigned_role, created_by, for_date, created_at
FROM public.nm_hub_tasks
ORDER BY created_at DESC
LIMIT 10;

-- -----------------------------------------------------------------------------
-- CHECKLIST MANUAL (fuera de SQL)
-- -----------------------------------------------------------------------------
-- A) Vercel: VITE_VAPID_PUBLIC_KEY = misma clave pública que en Supabase
-- B) Supabase → Edge Functions → Secrets:
--      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:tu@email.com
-- C) supabase functions deploy task-assigned-push
-- D) Database → Webhooks → INSERT nm_hub_tasks → URL de la función
--      Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
-- E) El DESTINATARIO (no el admin que asigna) debe:
--      - Activar avisos en SU celular con SU cuenta
--      - Tener fila en nm_hub_push_subscriptions (consulta 1)
-- F) Probar: admin asigna tarea a Dani → Dani con app cerrada o en segundo plano
-- G) Edge Functions → Logs → task-assigned-push → buscar { "sent": 1 }
--    sent:0 + no-subscriptions = Dani no activó avisos en ese celular
--    sent:0 + errors 401 = VAPID de Vercel y Supabase no coinciden
-- -----------------------------------------------------------------------------
