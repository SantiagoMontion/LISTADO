import { supabase } from './supabase'
import type { HubUserRole } from './types'

const SW_URL = '/sw.js'
const LS_PUSH_ENABLED = 'nm_hub_push_enabled'

export type HubPushSupport = {
  supported: boolean
  reason?: string
}

export function getHubPushSupport(): HubPushSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'no-window' }
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return { supported: false, reason: 'browser' }
  }
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()) {
    return { supported: false, reason: 'no-vapid' }
  }
  return { supported: true }
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export function isHubPushEnabledLocally(): boolean {
  try {
    return localStorage.getItem(LS_PUSH_ENABLED) === '1'
  } catch {
    return false
  }
}

function setHubPushEnabledLocally(on: boolean) {
  try {
    if (on) localStorage.setItem(LS_PUSH_ENABLED, '1')
    else localStorage.removeItem(LS_PUSH_ENABLED)
  } catch {
    /* ignore */
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_URL)
  if (existing) return existing
  return navigator.serviceWorker.register(SW_URL, { scope: '/' })
}

async function waitForActiveWorker(reg: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (reg.active) return reg
  await new Promise<void>((resolve) => {
    const sw = reg.installing ?? reg.waiting
    if (!sw) {
      resolve()
      return
    }
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated') resolve()
    })
  })
  return reg
}

export async function subscribeHubPush(userId: string): Promise<void> {
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
  if (!vapid) throw new Error('Falta VITE_VAPID_PUBLIC_KEY en el deploy.')
  if (!supabase) throw new Error('Supabase no configurado.')

  const reg = await waitForActiveWorker(await getServiceWorkerRegistration())
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    })
  }

  const json = sub.toJSON()
  const keys = json.keys
  if (!keys?.p256dh || !keys.auth) throw new Error('Suscripción push inválida.')

  const { error } = await supabase.from('nm_hub_push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent.slice(0, 512),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  setHubPushEnabledLocally(true)
}

export async function unsubscribeHubPush(userId: string): Promise<void> {
  if (!supabase) return
  const reg = await navigator.serviceWorker.getRegistration(SW_URL)
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    await supabase.from('nm_hub_push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  } else {
    await supabase.from('nm_hub_push_subscriptions').delete().eq('user_id', userId)
  }
  setHubPushEnabledLocally(false)
}

/** Pide permiso al SO y registra push + SW. */
export async function enableHubPushNotifications(userId: string): Promise<NotificationPermission> {
  const support = getHubPushSupport()
  if (!support.supported) {
    throw new Error(
      support.reason === 'no-vapid'
        ? 'Avisos no configurados en el servidor (clave VAPID).'
        : 'Este navegador no admite notificaciones push.',
    )
  }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm

  await subscribeHubPush(userId)
  return perm
}

export async function disableHubPushNotifications(userId: string): Promise<void> {
  await unsubscribeHubPush(userId)
}

let audioCtx: AudioContext | null = null

/** Sonido corto al recibir tarea (pestaña abierta o notificación del SO). */
export function playTaskAssignedSound(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    if (!audioCtx) audioCtx = new Ctx()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()

    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t0)
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.12)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.4)
  } catch {
    /* sin audio */
  }
}

export function showLocalTaskAssignedNotification(opts: {
  title: string
  taskId: string
  forDate?: string
}): void {
  if (typeof window === 'undefined' || Notification.permission !== 'granted') return

  const day = opts.forDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? opts.forDate : ''
  const url = day ? `/tareas?d=${day}#nm-hub-tareas-lista` : '/tareas#nm-hub-tareas-lista'

  playTaskAssignedSound()

  try {
    const n = new Notification('Nueva tarea asignada', {
      body: opts.title.trim() || 'Tarea del taller',
      tag: `nm-hub-task-${opts.taskId}`,
    })
    n.onclick = () => {
      window.focus()
      window.location.href = url
      n.close()
    }
  } catch {
    /* ignore */
  }
}

/** ¿Debe avisar a este usuario por una fila INSERT de nm_hub_tasks? */
export function shouldNotifyUserForNewTask(
  row: Record<string, unknown>,
  profileRole: HubUserRole,
  profileId: string,
  isAdmin: boolean,
): boolean {
  const assigned = typeof row.assigned_role === 'string' ? row.assigned_role : ''
  const createdBy = typeof row.created_by === 'string' ? row.created_by : null
  if (createdBy === profileId) return false
  if (isAdmin) return assigned.length > 0
  return assigned === profileRole
}
