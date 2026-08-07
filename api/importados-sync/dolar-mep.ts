import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchDolarMepQuote } from '../_lib/importados-sync/dolarMep.js'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' })
    return
  }

  const quote = await fetchDolarMepQuote()
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
  res.status(200).json({ ok: true, ...quote })
}
