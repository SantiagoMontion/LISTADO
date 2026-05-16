import { supabase } from './supabase'
import type { HubUserRole } from './types'

const SW_SCRIPT = '/sw.js'
const SW_SCOPE = '/'
const LS_PUSH_ENABLED = 'nm_hub_push_enabled'
export const HUB_PUSH_ENABLED_EVENT = 'nm-hub-push-enabled'

function dispatchPushEnabledEvent() {
  try {
    window.dispatchEvent(new CustomEvent(HUB_PUSH_ENABLED_EVENT))
  } catch {
    /* ignore */
  }
}

export type HubPushSupportReason =
  | 'no-window'
  | 'no-vapid'
  | 'browser'
  /** iPhone/iPad: hace falta PWA en pantalla de inicio (Safari); Chrome en iOS no sirve. */
  | 'ios-pwa-required'
  /** PWA instalada pero sin APIs (iOS viejo o acceso creado desde Chrome). */
  | 'ios-pwa-unsupported'
  | 'safari-mac-old'

export type HubPushSupport = {
  supported: boolean
  reason?: HubPushSupportReason
}

function isSafariBrowser(): boolean {
  const ua = navigator.userAgent
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua)
}

function isIosDevice(): boolean {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Pasos para activar push en iPhone/iPad (solo cuando `ios-pwa-required`). */
export function getHubPushIosInstallSteps(): string[] {
  return [
    'En iPhone, Chrome no puede enviar avisos (limitación de Apple). Usá Safari.',
    'En Safari: botón Compartir (cuadrado con flecha ↑) → «Agregar a pantalla de inicio».',
    'Abrí NOT BRAIN desde el ícono nuevo en el inicio (no desde Chrome ni una pestaña).',
    'En el inicio del panel, tocá «Permitir avisos cuando te asignen tareas».',
    'Necesitás iOS 16.4 o superior (Ajustes → General → Actualización de software).',
  ]
}

/** Texto de ayuda cuando push no está disponible en este navegador. */
export function getHubPushUnsupportedHint(reason?: HubPushSupportReason): string {
  switch (reason) {
    case 'no-vapid':
      return 'Avisos no configurados en el servidor (falta VITE_VAPID_PUBLIC_KEY en el deploy).'
    case 'ios-pwa-required':
      return 'En iPhone/iPad los avisos solo funcionan si agregás el sitio a la pantalla de inicio con Safari (no con Chrome).'
    case 'ios-pwa-unsupported':
      return 'Este acceso directo no admite avisos. Borralo, abrí el sitio en Safari, volvé a «Agregar a pantalla de inicio» y activá avisos desde el ícono del inicio.'
    case 'safari-mac-old':
      return 'En Mac necesitás macOS 13+ y Safari 16+. Luego: Safari → Ajustes para este sitio web → Notificaciones → Permitir.'
    case 'browser':
      return 'Este navegador no admite avisos push. En Android usá Chrome; en iPhone usá Safari y agregá el sitio al inicio.'
    default:
      return 'Avisos no disponibles en este navegador.'
  }
}

export function isHubPushIosDevice(): boolean {
  return typeof window !== 'undefined' && isIosDevice()
}

export function getHubPushSupport(): HubPushSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'no-window' }
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()) {
    return { supported: false, reason: 'no-vapid' }
  }

  const hasNotification = 'Notification' in window
  const hasServiceWorker = 'serviceWorker' in navigator
  const hasPushManager = 'PushManager' in window
  const safari = isSafariBrowser()
  const ios = isIosDevice()
  const standalone = isStandaloneDisplay()

  /** Cualquier navegador en iOS (Chrome, Firefox, etc.) = WebKit; push solo en PWA desde Safari. */
  if (ios && !standalone) {
    return { supported: false, reason: 'ios-pwa-required' }
  }

  if (ios && standalone && (!hasNotification || !hasServiceWorker || !hasPushManager)) {
    return { supported: false, reason: 'ios-pwa-unsupported' }
  }

  if (!hasNotification || !hasServiceWorker || !hasPushManager) {
    if (safari && !ios) return { supported: false, reason: 'safari-mac-old' }
    return { supported: false, reason: 'browser' }
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
  const existing =
    (await navigator.serviceWorker.getRegistration(SW_SCOPE)) ??
    (await navigator.serviceWorker.getRegistration())
  if (existing?.active) return existing
  return navigator.serviceWorker.register(SW_SCRIPT, { scope: SW_SCOPE })
}

/** Registra el SW al cargar la app (mejora entrega en Android/iOS PWA). */
export function prefetchHubPushServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()) return
  void getServiceWorkerRegistration().catch(() => {
    /* ignore */
  })
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

  const saved = await verifyHubPushSubscriptionSaved(userId)
  if (!saved) {
    throw new Error('No se pudo guardar la suscripción push. Revisá la conexión e intentá de nuevo.')
  }

  setHubPushEnabledLocally(true)
  dispatchPushEnabledEvent()
}

export async function verifyHubPushSubscriptionSaved(userId: string): Promise<boolean> {
  if (!supabase) return false
  const { count, error } = await supabase
    .from('nm_hub_push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) return false
  return (count ?? 0) > 0
}

export async function unsubscribeHubPush(userId: string): Promise<void> {
  if (!supabase) return
  const reg = await getServiceWorkerRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    await supabase.from('nm_hub_push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  } else {
    await supabase.from('nm_hub_push_subscriptions').delete().eq('user_id', userId)
  }
  setHubPushEnabledLocally(false)
  dispatchPushEnabledEvent()
}

/** Pide permiso al SO y registra push + SW. */
export async function enableHubPushNotifications(userId: string): Promise<NotificationPermission> {
  const support = getHubPushSupport()
  if (!support.supported) {
    throw new Error(getHubPushUnsupportedHint(support.reason))
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

/** Muestra aviso en el sistema (vía SW; en celular `new Notification` casi no sirve). */
export async function showTaskAssignedNotification(opts: {
  title: string
  taskId: string
  forDate?: string
}): Promise<void> {
  if (typeof window === 'undefined' || Notification.permission !== 'granted') return
  if (!isHubPushEnabledLocally()) return

  const day = opts.forDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? opts.forDate : ''
  const url = day ? `/tareas?d=${day}#nm-hub-tareas-lista` : '/tareas#nm-hub-tareas-lista'
  const body = opts.title.trim() || 'Tarea del taller'
  const tag = `nm-hub-task-${opts.taskId}`

  playTaskAssignedSound()

  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('Nueva tarea asignada', {
      body,
      tag,
      data: { url },
    } as NotificationOptions)
    return
  } catch {
    /* fallback escritorio */
  }

  try {
    const n = new Notification('Nueva tarea asignada', { body, tag })
    n.onclick = () => {
      window.focus()
      window.location.href = url
      n.close()
    }
  } catch {
    /* ignore */
  }
}

/** @deprecated Usar showTaskAssignedNotification */
export function showLocalTaskAssignedNotification(opts: {
  title: string
  taskId: string
  forDate?: string
}): void {
  void showTaskAssignedNotification(opts)
}

/** ¿Debe avisar a este usuario por una fila INSERT de nm_hub_tasks? */
export function shouldNotifyUserForNewTask(
  row: Record<string, unknown>,
  profileRole: HubUserRole,
  profileId: string,
): boolean {
  const assigned = typeof row.assigned_role === 'string' ? row.assigned_role : ''
  const createdBy = typeof row.created_by === 'string' ? row.created_by : null
  if (createdBy === profileId) return false
  return assigned === profileRole
}
