import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv } from '../_lib/importados-sync/env.js'
import { loadPrintPdfBuffer } from '../_lib/personalizados-pdfs/pendingPdfs.js'

export const config = {
  maxDuration: 60,
}

function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(status).json(payload)
}

function readBearer(req: VercelRequest): string | null {
  const raw = req.headers.authorization ?? req.headers.Authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header !== 'string') return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

async function requireHubUser(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const token = readBearer(req)
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return false
  }
  const { url, serviceRoleKey } = getSupabaseEnv()
  const authClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return false
  }
  return true
}

function pickQuery(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return typeof value === 'string' ? value.trim() : ''
}

function contentDispositionFilename(fileName: string): string {
  const safe = fileName.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180) || 'archivo.pdf'
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }
  if (!(await requireHubUser(req, res))) return

  const printId = pickQuery(req.query?.printId)
  if (!printId) {
    sendJson(res, 400, { ok: false, error: 'printId_required' })
    return
  }

  try {
    const file = await loadPrintPdfBuffer(printId)
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', contentDispositionFilename(file.fileName))
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(Buffer.from(file.buffer))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[personalizados-pdfs/file]', message)
    const status =
      message === 'print_not_found' || message === 'object_not_found' || message === 'missing_file_path'
        ? 404
        : 500
    sendJson(res, status, { ok: false, error: message })
  }
}
