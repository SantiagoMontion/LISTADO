/**
 * Envía Web Push a usuarios con el rol asignado en nm_hub_tasks (INSERT).
 *
 * Secrets (Supabase → Edge Functions):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TASK_PUSH_WEBHOOK_SECRET (opcional; header Authorization: Bearer …)
 *
 * Database Webhook: INSERT en nm_hub_tasks → POST a esta función.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hola@notmid.com'

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
}

type WebhookPayload = {
  type?: string
  table?: string
  record?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const webhookSecret = Deno.env.get('TASK_PUSH_WEBHOOK_SECRET')
  if (webhookSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${webhookSecret}`) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }
  }

  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: 'VAPID keys missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: WebhookPayload
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (body.type !== 'INSERT' || body.table !== 'nm_hub_tasks' || !body.record) {
    return new Response(JSON.stringify({ skipped: true, sent: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const task = body.record
  const assignedRole = typeof task.assigned_role === 'string' ? task.assigned_role : ''
  const createdBy = typeof task.created_by === 'string' ? task.created_by : null
  const title = typeof task.title === 'string' ? task.title.trim() : 'Nueva tarea'
  const forDate = typeof task.for_date === 'string' ? task.for_date : ''
  const taskId = typeof task.id === 'string' ? task.id : 'task'

  if (!assignedRole) {
    return new Response(JSON.stringify({ skipped: true, sent: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: profiles, error: profErr } = await supabase
    .from('nm_hub_profiles')
    .select('id')
    .eq('role', assignedRole)

  if (profErr) {
    return new Response(JSON.stringify({ error: profErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userIds = (profiles ?? []).map((p) => p.id as string).filter((id) => id && id !== createdBy)
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: subs, error: subErr } = await supabase
    .from('nm_hub_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  if (subErr) {
    return new Response(JSON.stringify({ error: subErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const url = forDate.match(/^\d{4}-\d{2}-\d{2}$/)
    ? `/tareas?d=${forDate}#nm-hub-tareas-lista`
    : '/tareas#nm-hub-tareas-lista'

  const payload = JSON.stringify({
    title: 'Nueva tarea asignada',
    body: title,
    url,
    tag: `nm-hub-task-${taskId}`,
  })

  let sent = 0
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
        },
        payload,
      )
      sent += 1
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) {
        await supabase.from('nm_hub_push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
