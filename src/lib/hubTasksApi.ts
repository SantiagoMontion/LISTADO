import { normalizeCalendarDate } from './date'
import { supabase } from './supabase'
import type { HubImportance, NmHubTask } from './types'

const BUCKET = 'nm-hub-task-images'

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
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
  return (data ?? []) as NmHubTask[]
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
  return (data ?? []) as NmHubTask[]
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
  assigned_to?: string | null
}): Promise<NmHubTask> {
  const sb = requireClient()
  const day = normalizeCalendarDate(input.for_date)
  const { data, error } = await sb
    .from('nm_hub_tasks')
    .insert({
      title: input.title.trim(),
      body: input.body?.trim() || null,
      importance: input.importance,
      for_date: day,
      due_at: null,
      image_paths: [],
      assigned_to: input.assigned_to ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as NmHubTask
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

export async function appendTaskImages(taskId: string, files: File[]): Promise<string[]> {
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

  const { data: row, error: fetchErr } = await sb.from('nm_hub_tasks').select('image_paths').eq('id', taskId).single()
  if (fetchErr) throw fetchErr
  const prev = (row?.image_paths as string[] | undefined) ?? []
  const next = [...prev, ...uploaded]

  const { error: upErr } = await sb.from('nm_hub_tasks').update({ image_paths: next }).eq('id', taskId)
  if (upErr) throw upErr

  return uploaded
}

export async function signedImageUrl(path: string, expiresSec = 60 * 30): Promise<string | null> {
  const sb = requireClient()
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresSec)
  if (error) return null
  return data.signedUrl
}
