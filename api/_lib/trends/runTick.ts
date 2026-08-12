import { getSupabase } from '../importados-sync/supabase.js'
import { analyzeItem } from './analyze.js'
import { collectForTask } from './connectors.js'
import {
  clusterFingerprint,
  contentHash,
  parseTaskConfig,
  type TrendSearchTask,
} from './types.js'

export type TrendsTickSummary = {
  ok: boolean
  runId: string
  tasksProcessed: number
  itemsFetched: number
  itemsInserted: number
  itemsAnalyzed: number
  alertsCreated: number
  errors: string[]
  durationMs: number
}

function mapTask(row: Record<string, unknown>): TrendSearchTask {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    niche: String(row.niche ?? ''),
    config: parseTaskConfig(row.config),
    schedule_minutes: Number(row.schedule_minutes) || 30,
    is_active: Boolean(row.is_active),
    last_run_at: typeof row.last_run_at === 'string' ? row.last_run_at : null,
  }
}

function isDue(task: TrendSearchTask, now: number): boolean {
  if (!task.last_run_at) return true
  const last = Date.parse(task.last_run_at)
  if (!Number.isFinite(last)) return true
  return now - last >= task.schedule_minutes * 60_000
}

export async function runTrendsTick(opts?: {
  trigger?: string
  maxTasks?: number
  analyzeLimit?: number
  onlyTaskId?: string
}): Promise<TrendsTickSummary> {
  const started = Date.now()
  const trigger = opts?.trigger ?? 'cron'
  const maxTasks = opts?.maxTasks ?? 3
  const analyzeLimit = opts?.analyzeLimit ?? 25
  const errors: string[] = []
  const sb = getSupabase()

  const { data: runRow, error: runErr } = await sb
    .from('trend_runs')
    .insert({ trigger, status: 'running', summary: {} })
    .select('id')
    .single()
  if (runErr || !runRow) {
    throw new Error(`trend_runs insert failed: ${runErr?.message ?? 'unknown'}`)
  }
  const runId = String(runRow.id)

  let tasksProcessed = 0
  let itemsFetched = 0
  let itemsInserted = 0
  let itemsAnalyzed = 0
  let alertsCreated = 0

  try {
    let tasksQuery = sb
      .from('trend_search_tasks')
      .select('id, name, niche, config, schedule_minutes, is_active, last_run_at')
      .eq('is_active', true)
      .order('last_run_at', { ascending: true, nullsFirst: true })

    if (opts?.onlyTaskId) {
      tasksQuery = tasksQuery.eq('id', opts.onlyTaskId)
    }

    const { data: taskRows, error: taskErr } = await tasksQuery
    if (taskErr) throw new Error(taskErr.message)

    const now = Date.now()
    const due = (taskRows ?? [])
      .map((r) => mapTask(r as Record<string, unknown>))
      .filter((t) => (opts?.onlyTaskId ? true : isDue(t, now)))
      .slice(0, maxTasks)

    for (const task of due) {
      tasksProcessed += 1
      try {
        const collected = await collectForTask(task, 18)
        itemsFetched += collected.length

        for (const item of collected) {
          const hash = contentHash(item.title, item.url, item.body)
          const { data: inserted, error: upErr } = await sb
            .from('trend_raw_items')
            .upsert(
              {
                task_id: task.id,
                source: item.source,
                external_id: item.externalId,
                url: item.url,
                title: item.title,
                body: item.body,
                author: item.author,
                published_at: item.publishedAt,
                media: item.media,
                engagement: item.engagement,
                content_hash: hash,
                raw_json: item.raw,
                fetched_at: new Date().toISOString(),
              },
              { onConflict: 'source,external_id', ignoreDuplicates: true },
            )
            .select('id')

          if (upErr) {
            errors.push(`raw upsert ${item.externalId}: ${upErr.message}`)
            continue
          }
          if (inserted?.length) itemsInserted += inserted.length
        }

        await sb
          .from('trend_search_tasks')
          .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', task.id)
      } catch (err) {
        errors.push(`task ${task.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Analizar raw items sin análisis aún
    const { data: pending } = await sb
      .from('trend_raw_items')
      .select(
        'id, task_id, source, external_id, url, title, body, author, published_at, media, engagement, raw_json',
      )
      .order('fetched_at', { ascending: false })
      .limit(analyzeLimit * 3)

    const pendingRows = pending ?? []
    if (pendingRows.length) {
      const ids = pendingRows.map((r) => String(r.id))
      const { data: already } = await sb
        .from('trend_analyzed_items')
        .select('raw_item_id')
        .in('raw_item_id', ids)
      const done = new Set((already ?? []).map((r) => String(r.raw_item_id)))
      const todo = pendingRows.filter((r) => !done.has(String(r.id))).slice(0, analyzeLimit)

      const taskCache = new Map<string, TrendSearchTask>()
      for (const row of todo) {
        try {
          const taskId = String(row.task_id)
          let task = taskCache.get(taskId)
          if (!task) {
            const { data: trow } = await sb
              .from('trend_search_tasks')
              .select('id, name, niche, config, schedule_minutes, is_active, last_run_at')
              .eq('id', taskId)
              .maybeSingle()
            if (!trow) continue
            task = mapTask(trow as Record<string, unknown>)
            taskCache.set(taskId, task)
          }

          const normalized = {
            source: row.source as TrendSearchTask['config']['sources_enabled'][number],
            externalId: String(row.external_id),
            url: typeof row.url === 'string' ? row.url : null,
            title: String(row.title ?? ''),
            body: String(row.body ?? ''),
            author: typeof row.author === 'string' ? row.author : null,
            publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
            media: Array.isArray(row.media) ? (row.media as Array<{ url: string; type?: string }>) : [],
            engagement:
              row.engagement && typeof row.engagement === 'object'
                ? (row.engagement as Record<string, number>)
                : {},
            raw:
              row.raw_json && typeof row.raw_json === 'object'
                ? (row.raw_json as Record<string, unknown>)
                : {},
          }

          const analysis = await analyzeItem(normalized, task)
          const { data: analyzed, error: aErr } = await sb
            .from('trend_analyzed_items')
            .insert({
              raw_item_id: row.id,
              task_id: taskId,
              relevance: analysis.relevance,
              sentiment: analysis.sentiment,
              virality_score: analysis.virality_score,
              impact_summary: analysis.impact_summary,
              keywords: analysis.keywords,
              entities: analysis.entities,
              signal_type: analysis.signal_type,
              product_angle: analysis.product_angle,
              content_angle: analysis.content_angle,
              is_emerging: analysis.is_emerging,
              confidence: analysis.confidence,
              language: analysis.language,
              analysis_json: analysis,
            })
            .select('id')
            .single()

          if (aErr) {
            errors.push(`analyze ${row.id}: ${aErr.message}`)
            continue
          }
          itemsAnalyzed += 1

          const fp = clusterFingerprint(normalized.title, analysis.keywords)
          const { data: existingCluster } = await sb
            .from('trend_clusters')
            .select('id, item_count, max_virality, sources')
            .eq('task_id', taskId)
            .eq('fingerprint', fp)
            .maybeSingle()

          let clusterId: string | null = existingCluster ? String(existingCluster.id) : null
          let clusterSources = existingCluster?.sources
            ? (existingCluster.sources as string[])
            : []

          if (existingCluster) {
            clusterSources = Array.from(
              new Set([...clusterSources, normalized.source].map(String)),
            )
            await sb
              .from('trend_clusters')
              .update({
                item_count: Number(existingCluster.item_count || 1) + 1,
                max_virality: Math.max(
                  Number(existingCluster.max_virality) || 0,
                  analysis.virality_score,
                ),
                sources: clusterSources,
                last_seen_at: new Date().toISOString(),
              })
              .eq('id', existingCluster.id)
          } else {
            const { data: createdCluster } = await sb
              .from('trend_clusters')
              .insert({
                task_id: taskId,
                label: normalized.title.slice(0, 120),
                fingerprint: fp,
                item_count: 1,
                max_virality: analysis.virality_score,
                sources: [normalized.source],
                last_seen_at: new Date().toISOString(),
              })
              .select('id, sources')
              .maybeSingle()
            clusterId = createdCluster ? String(createdCluster.id) : null
            clusterSources = createdCluster?.sources
              ? (createdCluster.sources as string[])
              : [normalized.source]
          }

          const multiSource = clusterSources.length >= 2
          if (
            analysis.is_emerging ||
            (analysis.virality_score >= 70 && analysis.relevance >= 50) ||
            multiSource
          ) {
            const { error: alertErr } = await sb.from('trend_alerts').insert({
              task_id: taskId,
              analyzed_item_id: analyzed?.id ?? null,
              cluster_id: clusterId,
              severity: analysis.virality_score >= 80 ? 'high' : 'info',
              title: `${task.name}: ${normalized.title.slice(0, 100)}`,
              body:
                analysis.impact_summary ||
                analysis.content_angle ||
                analysis.product_angle ||
                '',
            })
            if (!alertErr) alertsCreated += 1
          }
        } catch (err) {
          errors.push(`analyze row: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    const summary = {
      ok: true,
      runId,
      tasksProcessed,
      itemsFetched,
      itemsInserted,
      itemsAnalyzed,
      alertsCreated,
      errors,
      durationMs: Date.now() - started,
    }

    await sb
      .from('trend_runs')
      .update({
        status: errors.length ? 'completed_with_errors' : 'completed',
        finished_at: new Date().toISOString(),
        summary,
      })
      .eq('id', runId)

    return summary
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const summary = {
      ok: false,
      runId,
      tasksProcessed,
      itemsFetched,
      itemsInserted,
      itemsAnalyzed,
      alertsCreated,
      errors: [...errors, message],
      durationMs: Date.now() - started,
    }
    await sb
      .from('trend_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        summary,
      })
      .eq('id', runId)
    return summary
  }
}
