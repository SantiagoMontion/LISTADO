import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireTrendsAdmin, sendJson } from '../_lib/trends/auth.js'
import { runTrendsTick } from '../_lib/trends/runTick.js'

export const config = {
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }

  if (!(await requireTrendsAdmin(req, res))) return

  try {
    const onlyTaskId =
      typeof req.query.taskId === 'string'
        ? req.query.taskId.trim()
        : typeof req.body?.taskId === 'string'
          ? String(req.body.taskId).trim()
          : ''

    const summary = await runTrendsTick({
      trigger: 'manual',
      maxTasks: onlyTaskId ? 1 : 4,
      analyzeLimit: 30,
      onlyTaskId: onlyTaskId || undefined,
    })
    sendJson(res, 200, { ...summary, source: 'manual', at: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, { ok: false, error: 'trends_run_failed', detail: message })
  }
}
