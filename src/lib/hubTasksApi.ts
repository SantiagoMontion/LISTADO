import { normalizeCalendarDate } from './date'
import { HUB_ROLE_LABEL } from './hubPermissions'
import { supabase } from './supabase'
import type { HubTaskAssignableRole } from './hubTaskAssignable'
import type { HubImportance, HubUserRole, NmHubTask, NmHubTaskNote } from './types'

const BUCKET = 'nm-hub-task-images'

function normalizeAssignedRole(raw: unknown): HubTaskAssignableRole {
  const s = typeof raw === 'string' ? raw : ''
  if (s === 'online_1' || s === 'taller_1' || s === 'lista_creator' || s === 'admin') return s
  return 'taller_1'
}

function coerceHubTask(row: Record<string, unknown>): NmHubTask {
  return {
    ...(row as unknown as NmHubTask),
    assigned_role: normalizeAssignedRole(row.assigned_role),
  }
}

function mapTaskRows(data: unknown): NmHubTask[] {
  return ((data ?? []) as Record<string, unknown>[]).map((r) => coerceHubTask(r))
}

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

function parseRpcTaskRow(data: unknown): NmHubTask | null {
  const raw = Array.isArray(data) ? data[0] : data
  if (!raw || typeof raw !== 'object') return null
  return coerceHubTask(raw as Record<string, unknown>)
}

/** Si el RPC insertó pero el cliente falló al leer, recuperar la fila recién creada. */
async function recoverRecentlyCreatedHubTask(
  forDate: string,
  title: string,
): Promise<NmHubTask | null> {
  const sb = requireClient()
  const { data: userData } = await sb.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return null

  const day = normalizeCalendarDate(forDate)
  const trimmed = title.trim()
  const { data, error } = await sb
    .from('nm_hub_tasks')
    .select('*')
    .eq('for_date', day)
    .eq('created_by', uid)
    .eq('title', trimmed)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return coerceHubTask(data as Record<string, unknown>)
}

export async function fetchHubTasksPending(forDate: string): Promise<NmHubTask[]> {
  const sb = requireClient()
  const day = normalizeCalendarDate(forDate)
  const { data, error } = await sb
    .from('nm_hub_tasks')
    .select('*')
    .eq('for_date', day)
    .is('executed_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return mapTaskRows(data)
}

export async function fetchHubTasksCompleted(forDate: string): Promise<NmHubTask[]> {
  const sb = requireClient()
  const day = normalizeCalendarDate(forDate)
  const { data, error } = await sb
    .from('nm_hub_tasks')
    .select('*')
    .eq('for_date', day)
    .not('executed_at', 'is', null)
    .order('executed_at', { ascending: false })

  if (error) throw error
  return mapTaskRows(data)
}

/** Hay al menos una tarea pendiente (sin ejecutar) con for_date anterior al día mostrado. */
export async function fetchHasPendingHubTasksBefore(forDate: string): Promise<boolean> {
  const sb = requireClient()
  const day = normalizeCalendarDate(forDate)
  const { count, error } = await sb
    .from('nm_hub_tasks')
    .select('id', { count: 'exact', head: true })
    .is('executed_at', null)
    .lt('for_date', day)

  if (error) throw error
  return (count ?? 0) > 0
}

/** Hay al menos una tarea pendiente (sin ejecutar) con for_date posterior al día mostrado. */
export async function fetchHasPendingHubTasksAfter(forDate: string): Promise<boolean> {
  const sb = requireClient()
  const day = normalizeCalendarDate(forDate)
  const { count, error } = await sb
    .from('nm_hub_tasks')
    .select('id', { count: 'exact', head: true })
    .is('executed_at', null)
    .gt('for_date', day)

  if (error) throw error
  return (count ?? 0) > 0
}

function profileLabelFromRow(displayName: string, role: string | null | undefined): string {
  const name = displayName.trim()
  if (name && name.toLowerCase() !== 'usuario') return name
  const r = role as HubUserRole | undefined
  if (r && HUB_ROLE_LABEL[r]) return HUB_ROLE_LABEL[r]
  return name || 'Usuario'
}

export type HubProfileDisplaySelf = {
  id: string
  displayName: string
  role: HubUserRole
}

/** Nombre legible de un usuario hub (perfil cargado, mapa RPC/tabla o rol). */
export function hubProfileDisplayLabel(
  userId: string | null | undefined,
  names: Record<string, string>,
  namesReady: boolean,
  self?: HubProfileDisplaySelf,
): string {
  if (!userId) return '—'
  if (self && userId === self.id) {
    const own = self.displayName.trim()
    if (own && own.toLowerCase() !== 'usuario') return own
    return HUB_ROLE_LABEL[self.role] ?? (own || 'Usuario')
  }
  const cached = names[userId]?.trim()
  if (cached) return cached
  return namesReady ? 'Usuario' : '…'
}

export async function fetchHubProfileDisplayNames(userIds: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(userIds.filter(Boolean))]
  if (uniq.length === 0) return {}
  const sb = requireClient()

  const { data: rpcData, error: rpcError } = await sb.rpc('nm_hub_profile_display_names', {
    p_user_ids: uniq,
  })

  if (!rpcError && Array.isArray(rpcData)) {
    const out: Record<string, string> = {}
    for (const row of rpcData as { user_id?: string; label?: string }[]) {
      const id = row.user_id
      const label = (row.label ?? '').trim()
      if (id && label) out[id] = label
    }
    if (Object.keys(out).length > 0) return out
  }

  if (rpcError) {
    console.warn('[nm-hub] nm_hub_profile_display_names:', rpcError.message)
  }

  const { data, error } = await sb
    .from('nm_hub_profiles')
    .select('id, display_name, role')
    .in('id', uniq)
  if (error) {
    console.warn('[nm-hub] perfiles display_name:', error.message)
    return {}
  }
  const out: Record<string, string> = {}
  for (const row of data ?? []) {
    const id = row.id as string
    out[id] = profileLabelFromRow((row.display_name as string) ?? '', row.role as string)
  }
  return out
}

export async function createHubTask(input: {
  title: string
  body: string | null
  importance: HubImportance
  for_date: string
  assigned_role: HubTaskAssignableRole
  assigned_to?: string | null
}): Promise<NmHubTask> {
  const sb = requireClient()
  const day = normalizeCalendarDate(input.for_date)

  const { data, error } = await sb.rpc('nm_hub_create_task', {
    p_title: input.title.trim(),
    p_body: input.body?.trim() || null,
    p_importance: input.importance,
    p_for_date: day,
    p_assigned_role: input.assigned_role,
    p_assigned_to: input.assigned_to ?? null,
  })

  const parsed = parseRpcTaskRow(data)
  if (!error && parsed) return parsed

  const msg = error
    ? [error.message, error.code, error.details].filter(Boolean).join(' — ')
    : ''
  const rlsLike =
    !parsed &&
    (error?.code === '42501' || /row-level security|permission denied|permiso/i.test(msg))

  if (rlsLike) {
    const recovered = await recoverRecentlyCreatedHubTask(day, input.title)
    if (recovered) return recovered
  }

  if (error) throw error
  throw new Error('La tarea se creó pero no se pudo leer la respuesta.')
}

export async function deleteHubTask(taskId: string): Promise<void> {
  const sb = requireClient()
  const { error } = await sb.rpc('nm_hub_delete_task', { p_task_id: taskId })
  if (error) throw error
}

export type TaskAssignedPushResult = {
  ok: boolean
  sent?: number
  reason?: string
  detail?: string
}

/** Dispara push al celular del rol asignado (Edge Function; también conviene webhook DB). */
export async function notifyTaskAssignedPush(task: NmHubTask): Promise<TaskAssignedPushResult> {
  const sb = requireClient()
  const { data, error } = await sb.functions.invoke('task-assigned-push', {
    body: {
      type: 'INSERT',
      table: 'nm_hub_tasks',
      record: {
        id: task.id,
        title: task.title,
        for_date: task.for_date,
        assigned_role: task.assigned_role,
        created_by: task.created_by ?? null,
      },
    },
  })

  if (error) {
    console.warn('[nm-hub] aviso push:', error.message)
    return { ok: false, detail: error.message }
  }

  const payload = data as { sent?: number; reason?: string; errors?: string[] } | null
  const sent = typeof payload?.sent === 'number' ? payload.sent : 0
  if (sent > 0) return { ok: true, sent }

  const reason = payload?.reason ?? 'unknown'
  const errHint = payload?.errors?.join('; ')
  console.warn('[nm-hub] aviso push sin envíos:', reason, errHint ?? '')
  return { ok: false, sent: 0, reason, detail: errHint }
}

export async function updateHubTaskExecuted(id: string, executed: boolean): Promise<void> {
  const sb = requireClient()
  const { data: userData } = await sb.auth.getUser()
  const uid = userData.user?.id ?? null
  const { error } = await sb
    .from('nm_hub_tasks')
    .update({
      executed_at: executed ? new Date().toISOString() : null,
      executed_by: executed ? uid : null,
    })
    .eq('id', id)

  if (error) throw error
}

export async function appendTaskImages(
  taskId: string,
  files: File[],
  existingPaths: string[] = [],
): Promise<string[]> {
  if (files.length === 0) return []
  const sb = requireClient()
  const uploaded: string[] = []

  for (const file of files) {
    const safe = file.name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120)
    const path = `${taskId}/${crypto.randomUUID()}-${safe}`
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (error) throw error
    uploaded.push(path)
  }

  let prev = existingPaths
  if (prev.length === 0) {
    const { data: prevRow } = await sb
      .from('nm_hub_tasks')
      .select('image_paths')
      .eq('id', taskId)
      .maybeSingle()
    prev = (prevRow?.image_paths as string[] | undefined) ?? []
  }
  const next = [...prev, ...uploaded]

  const { error: upErr } = await sb.rpc('nm_hub_set_task_image_paths', {
    p_task_id: taskId,
    p_image_paths: next,
  })
  if (upErr) throw upErr

  return uploaded
}

export async function signedImageUrl(path: string, expiresSec = 60 * 30): Promise<string | null> {
  const sb = requireClient()
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresSec)
  if (error) return null
  return data.signedUrl
}

function mapTaskNoteRow(row: Record<string, unknown>): NmHubTaskNote {
  return {
    id: row.id as string,
    task_id: row.task_id as string,
    author_id: row.author_id as string,
    body: String(row.body ?? ''),
    created_at: String(row.created_at ?? ''),
  }
}

export async function fetchHubTaskNotes(taskId: string): Promise<NmHubTaskNote[]> {
  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_task_notes')
    .select('id, task_id, author_id, body, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(mapTaskNoteRow)
}

export async function fetchHubTaskNoteCounts(taskIds: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(taskIds.filter(Boolean))]
  if (uniq.length === 0) return {}
  const sb = requireClient()
  const { data, error } = await sb.from('nm_hub_task_notes').select('task_id').in('task_id', uniq)
  if (error) throw error
  const out: Record<string, number> = {}
  for (const row of data ?? []) {
    const tid = row.task_id as string
    out[tid] = (out[tid] ?? 0) + 1
  }
  return out
}

export async function createHubTaskNote(taskId: string, body: string): Promise<NmHubTaskNote> {
  const sb = requireClient()
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Escribí una nota.')
  const { data: userData } = await sb.auth.getUser()
  const uid = userData.user?.id
  if (!uid) throw new Error('Sesión requerida.')

  const { data, error } = await sb
    .from('nm_hub_task_notes')
    .insert({ task_id: taskId, author_id: uid, body: trimmed })
    .select('id, task_id, author_id, body, created_at')
    .single()

  if (error) throw error
  return mapTaskNoteRow(data as Record<string, unknown>)
}

export async function updateHubTaskNote(noteId: string, body: string): Promise<NmHubTaskNote> {
  const sb = requireClient()
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Escribí una nota.')

  const { data, error } = await sb
    .from('nm_hub_task_notes')
    .update({ body: trimmed })
    .eq('id', noteId)
    .select('id, task_id, author_id, body, created_at')
    .single()

  if (error) throw error
  return mapTaskNoteRow(data as Record<string, unknown>)
}

export async function deleteHubTaskNote(noteId: string): Promise<void> {
  const sb = requireClient()
  const { error } = await sb.from('nm_hub_task_notes').delete().eq('id', noteId)
  if (error) throw error
}
