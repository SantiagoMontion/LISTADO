import { normalizeCalendarDate } from './date'
import { supabase } from './supabase'
import type { HubTaskAssignableRole } from './hubTaskAssignable'
import type { HubImportance, NmHubTask } from './types'

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

export async function fetchHubProfileDisplayNames(userIds: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(userIds.filter(Boolean))]
  if (uniq.length === 0) return {}
  const sb = requireClient()
  const { data, error } = await sb.from('nm_hub_profiles').select('id, display_name').in('id', uniq)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const row of data ?? []) {
    const id = row.id as string
    const name = ((row.display_name as string) ?? '').trim()
    out[id] = name || id.slice(0, 8)
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

/** Dispara push a quien tenga el rol asignado (Edge Function; respaldo del webhook DB). */
export async function notifyTaskAssignedPush(task: NmHubTask): Promise<void> {
  const sb = requireClient()
  const { error } = await sb.functions.invoke('task-assigned-push', {
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
  }
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
