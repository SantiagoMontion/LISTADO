import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendJson, verifyCronSecret } from '../_lib/trends/auth.js'
import { runTrendsTick } from '../_lib/trends/runTick.js'

export const config = {
  maxDuration: 60,
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
    const summary = await runTrendsTick({ trigger: 'cron', maxTasks: 3, analyzeLimit: 20 })
    sendJson(res, 200, { ...summary, source: 'cron', at: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[trends-tick] fatal', message)
    sendJson(res, 500, {
      ok: false,
      error: 'trends_tick_failed',
      detail: message,
      at: new Date().toISOString(),
    })
  }
}
