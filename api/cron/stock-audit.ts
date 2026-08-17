import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getCronSecret } from '../_lib/importados-sync/env.js'
import { runStockAudit } from '../_lib/importados-sync/stockAudit.js'
import { getSupabase } from '../_lib/importados-sync/supabase.js'

export const config = {
  maxDuration: 60,
}

function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(status).json(payload)
}

function verifyCron(req: VercelRequest): boolean {
  let expected: string
  try {
    expected = getCronSecret()
  } catch {
    return false
  }
  const raw = req.headers.authorization ?? req.headers.Authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header === 'string' && header === `Bearer ${expected}`) return true
  const cronHeader = req.headers['x-vercel-cron']
  return cronHeader === '1' || (Array.isArray(cronHeader) && cronHeader[0] === '1')
}

/** Guarda el reporte si existe la tabla; si no, solo responde. */
async function persistReport(report: unknown): Promise<boolean> {
  try {
    const sb = getSupabase()
    const { error } = await sb.from('importados_stock_audits').insert({
      report,
    })
    if (error) {
      console.warn('[stock-audit] persist skipped:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.warn(
      '[stock-audit] persist skipped:',
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }
  if (!verifyCron(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return
  }

  try {
    const offset = Number(req.query.offset ?? 0) || 0
    const maxProducts = Number(req.query.max ?? 5) || 5
    // Cron audit: reparar SOLO restocks (política Lethal no apaga qty>0).
    // Sin esto los ghost zeros nunca se curaban fuera del lote de sync.
    const repair = true
    const report = await runStockAudit({ repair, maxProducts, offset, forceAll: false })
    const saved = await persistReport(report)
    console.log(
      '[stock-audit] summary',
      JSON.stringify({
        offset,
        total: report.total,
        ok: report.ok,
        repaired: report.repaired,
        mismatch: report.mismatch,
        monitorOnly: report.monitorOnly,
        errors: report.errors,
        durationMs: report.durationMs,
        saved,
      }),
    )
    sendJson(res, 200, { ...report, saved, ok: true as const })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stock-audit] fatal', message)
    sendJson(res, 500, { ok: false, error: message })
  }
}
