import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getCronSecret } from '../_lib/importados-sync/env.js'
import { runInventorySync } from '../_lib/importados-sync/runSync.js'

export const config = {
  maxDuration: 60,
}

function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(status).json(payload)
}

function verifyCronSecret(req: VercelRequest): boolean {
  let expected: string
  try {
    expected = getCronSecret()
  } catch (err) {
    console.error('[sync-inventory] CRON_SECRET missing', err)
    return false
  }

  const raw = req.headers.authorization ?? req.headers.Authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header === 'string' && header === `Bearer ${expected}`) {
    return true
  }

  // Vercel Cron envía este header en invocaciones programadas / CLI.
  const cronHeader = req.headers['x-vercel-cron']
  const isVercelCron = cronHeader === '1' || (Array.isArray(cronHeader) && cronHeader[0] === '1')
  if (isVercelCron && expected) {
    return true
  }

  console.error('[sync-inventory] unauthorized', {
    hasAuth: Boolean(header),
    vercelCron: cronHeader ?? null,
  })
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }

  if (!verifyCronSecret(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return
  }

  try {
    const focus =
      typeof req.query.focus === 'string' ? req.query.focus.trim() : ''
    const onlyId =
      typeof req.query.id === 'string' ? req.query.id.trim() : ''
    const maxRaw =
      typeof req.query.max === 'string' ? Number(req.query.max) : NaN
    const summary = await runInventorySync({
      onlyHandle: focus || undefined,
      onlyProductId: onlyId || undefined,
      maxProducts: Number.isFinite(maxRaw) ? maxRaw : undefined,
    })
    console.log('[sync-inventory] done', {
      checked: summary.checked,
      updated: summary.updated,
      restocked: summary.shopifyRestocked,
      zeroed: summary.shopifyZeroed,
      pricesUpdated: summary.shopifyPricesUpdated,
      skipped: summary.skipped,
      deferredFresh: summary.deferredFresh,
      deferredQueue: summary.deferredQueue,
      errors: summary.errors.length,
      durationMs: summary.durationMs,
    })
    sendJson(res, 200, {
      ...summary,
      source: 'cron',
      focus: focus || null,
      at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[sync-inventory] fatal', message)
    sendJson(res, 500, {
      ok: false,
      error: 'sync_failed',
      detail: message,
      at: new Date().toISOString(),
    })
  }
}
