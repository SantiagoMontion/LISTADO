-- =============================================================================
-- NOTMID — Suscripciones Web Push (avisos de tarea asignada en el celular)
-- Ejecutar en SQL Editor tras backup.
--
-- Después: desplegar Edge Function `task-assigned-push` y crear Database Webhook
--   tabla nm_hub_tasks · evento INSERT · URL de la función
--   Header: Authorization: Bearer <TASK_PUSH_WEBHOOK_SECRET>
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nm_hub_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nm_hub_push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_nm_hub_push_sub_user ON public.nm_hub_push_subscriptions (user_id);

ALTER TABLE public.nm_hub_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_hub_push_sub_select ON public.nm_hub_push_subscriptions;
DROP POLICY IF EXISTS nm_hub_push_sub_insert ON public.nm_hub_push_subscriptions;
DROP POLICY IF EXISTS nm_hub_push_sub_update ON public.nm_hub_push_subscriptions;
DROP POLICY IF EXISTS nm_hub_push_sub_delete ON public.nm_hub_push_subscriptions;

CREATE POLICY nm_hub_push_sub_select
  ON public.nm_hub_push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY nm_hub_push_sub_insert
  ON public.nm_hub_push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY nm_hub_push_sub_update
  ON public.nm_hub_push_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY nm_hub_push_sub_delete
  ON public.nm_hub_push_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.nm_hub_push_subscriptions IS
  'Endpoints Web Push por usuario (navegador / PWA). Usado por task-assigned-push.';

-- -----------------------------------------------------------------------------
-- Despliegue push (resumen)
-- 1) npx web-push generate-vapid-keys
-- 2) Vercel / .env: VITE_VAPID_PUBLIC_KEY=<publicKey>
-- 3) supabase secrets set VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT=mailto:…
-- 4) supabase functions deploy task-assigned-push
-- 5) Dashboard → Database → Webhooks → INSERT nm_hub_tasks → URL de la función
--    Header Authorization: Bearer <TASK_PUSH_WEBHOOK_SECRET> (mismo secret en la función)
-- -----------------------------------------------------------------------------
