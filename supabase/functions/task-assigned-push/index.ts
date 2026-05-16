/**
 * Envía Web Push a usuarios con el rol asignado en nm_hub_tasks (INSERT).
 *
 * Secrets (Supabase → Edge Functions):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *   TASK_PUSH_WEBHOOK_SECRET (opcional; también acepta service role en Authorization)
 *
 * Disparadores:
 *   - Database Webhook INSERT en nm_hub_tasks
 *   - Cliente: functions.invoke tras createHubTask (respaldo si el webhook falla)
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

function extractTaskRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.record && typeof b.record === 'object') return b.record as Record<string, unknown>
  if (typeof b.id === 'string' && typeof b.assigned_role === 'string') return b
  return null
}

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? ''
  const webhookSecret = Deno.env.get('TASK_PUSH_WEBHOOK_SECRET') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  if (webhookSecret && auth === `Bearer ${webhookSecret}`) return true
  if (serviceKey && auth === `Bearer ${serviceKey}`) return true

  if (!auth.startsWith('Bearer ') || !anonKey) return false

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, anonKey, {
    global: { headers: { Authorization: auth } },
  })
  const { data, error } = await userClient.auth.getUser()
  return Boolean(data.user && !error)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: 'VAPID keys missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payload = body as WebhookPayload
  const task = extractTaskRecord(body)

  if (payload.type && payload.type !== 'INSERT') {
    return new Response(JSON.stringify({ skipped: true, sent: 0, reason: 'not-insert' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (payload.table && payload.table !== 'nm_hub_tasks') {
    return new Response(JSON.stringify({ skipped: true, sent: 0, reason: 'wrong-table' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!task) {
    return new Response(JSON.stringify({ skipped: true, sent: 0, reason: 'no-record' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const assignedRole = typeof task.assigned_role === 'string' ? task.assigned_role : ''
  const createdBy = typeof task.created_by === 'string' ? task.created_by : null
  const title = typeof task.title === 'string' ? task.title.trim() : 'Nueva tarea'
  const forDate = typeof task.for_date === 'string' ? task.for_date : ''
  const taskId = typeof task.id === 'string' ? task.id : 'task'

  if (!assignedRole) {
    return new Response(JSON.stringify({ skipped: true, sent: 0, reason: 'no-assigned-role' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const roleNorm = assignedRole.trim().toLowerCase()

  const { data: profiles, error: profErr } = await supabase.from('nm_hub_profiles').select('id, role')

  if (profErr) {
    return new Response(JSON.stringify({ error: profErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userIds = (profiles ?? [])
    .filter((p) => {
      const r = typeof p.role === 'string' ? p.role.trim().toLowerCase() : ''
      return r === roleNorm
    })
    .map((p) => p.id as string)
    .filter((id) => id && id !== createdBy)
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no-target-users', assignedRole }), {
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

  if (!subs?.length) {
    return new Response(
      JSON.stringify({ sent: 0, reason: 'no-subscriptions', targetUsers: userIds.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const url = forDate.match(/^\d{4}-\d{2}-\d{2}$/)
    ? `/tareas?d=${forDate}#nm-hub-tareas-lista`
    : '/tareas#nm-hub-tareas-lista'

  const pushPayload = JSON.stringify({
    title: 'Nueva tarea asignada',
    body: title,
    url,
    tag: `nm-hub-task-${taskId}`,
  })

  let sent = 0
  const errors: string[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
        },
        pushPayload,
      )
      sent += 1
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode
      const msg = (e as { message?: string })?.message ?? String(e)
      errors.push(`${status ?? '?'}:${msg.slice(0, 80)}`)
      if (status === 404 || status === 410) {
        await supabase.from('nm_hub_push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  return new Response(
    JSON.stringify({
      sent,
      targets: userIds.length,
      subscriptions: subs.length,
      errors: errors.slice(0, 3),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
