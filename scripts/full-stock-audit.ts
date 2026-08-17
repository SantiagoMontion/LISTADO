/**
 * One-shot: audita y repara TODOS los tracked products (forceAll).
 * Uso: npx tsx scripts/full-stock-audit.ts
 * Requiere .env.cron.tmp (vercel env pull).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(path: string) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`)
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvFile(resolve(process.cwd(), '.env.cron.tmp'))

const { runStockAudit } = await import('../api/_lib/importados-sync/stockAudit.ts')
const { fetchActiveTrackedProducts } = await import('../api/_lib/importados-sync/supabase.ts')

const all = await fetchActiveTrackedProducts()
const ids = [...all].map((p) => p.id).sort((a, b) => a.localeCompare(b))
console.log(`[full-audit] activos: ${ids.length}`)

const batchSize = 2
const summary = {
  total: 0,
  ok: 0,
  repaired: 0,
  mismatch: 0,
  monitorOnly: 0,
  errors: 0,
  seen: new Set<string>(),
  zeroedOrLow: [] as Array<{ handle: string | null; title: string; status: string; variants: string }>,
}

for (let i = 0; i < ids.length; i += batchSize) {
  const chunk = ids.slice(i, i + batchSize)
  console.log(`[full-audit] lote ${i}-${i + chunk.length - 1} de ${ids.length}`)
  const report = await runStockAudit({
    repair: true,
    forceAll: true,
    productIds: chunk,
  })
  summary.total += report.total
  summary.ok += report.ok
  summary.repaired += report.repaired
  summary.mismatch += report.mismatch
  summary.monitorOnly += report.monitorOnly
  summary.errors += report.errors

  for (const p of report.products) {
    summary.seen.add(p.id)
    const interesting = p.variants.some(
      (v) => v.shopifyQty <= 0 || v.status === 'repaired' || v.status === 'mismatch' || v.status === 'error',
    )
    if (interesting || p.status !== 'ok') {
      summary.zeroedOrLow.push({
        handle: p.handle,
        title: p.title,
        status: p.status,
        variants: p.variants
          .map((v) => `${v.label}: supp=${v.supplierQty} shop=${v.shopifyQty} (${v.status}${v.detail ? '/' + v.detail : ''})`)
          .join(' | '),
      })
    }
  }

  // Respiro largo entre lotes: Lethal Cloudflare.
  await new Promise((r) => setTimeout(r, 5000))
}

console.log(
  '[full-audit] SUMMARY',
  JSON.stringify(
    {
      ...summary,
      seen: summary.seen.size,
      expected: ids.length,
      missing: ids.length - summary.seen.size,
      zeroedOrLow: summary.zeroedOrLow,
    },
    null,
    2,
  ),
)
