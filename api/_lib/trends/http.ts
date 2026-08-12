import { load as loadHtml } from 'cheerio'
import type { NormalizedTrendItem, TrendSourceId } from './types.js'

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json, application/rss+xml, application/xml, text/xml, */*',
      'User-Agent': 'NOTMID-BRAIN-Trends/1.0 (personal admin monitor)',
      ...(init?.headers ?? {}),
    },
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`)
  }
  return resp.text()
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const text = await fetchText(url, init)
  return JSON.parse(text) as T
}

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function safeIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseRssItems(xml: string, source: TrendSourceId): NormalizedTrendItem[] {
  const $ = loadHtml(xml, { xml: true })
  const items: NormalizedTrendItem[] = []

  const pushItem = (opts: {
    idx: number
    title: string
    link: string | null
    description: string
    pubDate: string
    author: string | null
    media: Array<{ url: string; type?: string }>
    engagement: Record<string, number>
    raw: Record<string, unknown>
  }) => {
    if (!opts.title && !opts.link) return
    items.push({
      source,
      externalId: `${source}:${opts.link || opts.title}:${opts.idx}`,
      url: opts.link,
      title: opts.title || '(sin título)',
      body: stripHtml(opts.description).slice(0, 2000),
      author: opts.author,
      publishedAt: safeIsoDate(opts.pubDate),
      media: opts.media,
      engagement: opts.engagement,
      raw: opts.raw,
    })
  }

  $('item').each((idx, el) => {
    const node = $(el)
    const title = node.find('title').first().text().trim()
    const link =
      node.find('link').first().text().trim() ||
      node.find('guid').first().text().trim() ||
      null
    const description = node.find('description').first().text().trim()
    const pubDate = node.find('pubDate').first().text().trim()
    const author =
      node.find('author').first().text().trim() ||
      node.find('dc\\:creator').first().text().trim() ||
      null

    const media: Array<{ url: string; type?: string }> = []
    const enclosure = node.find('enclosure').attr('url')
    if (enclosure) media.push({ url: enclosure, type: 'image' })
    const picture =
      node.find('ht\\:picture').first().text().trim() ||
      node.find('media\\:content').attr('url') ||
      ''
    if (picture) media.push({ url: picture, type: 'image' })

    const trafficRaw = node.find('ht\\:approx_traffic').first().text().trim()
    const traffic = Number(String(trafficRaw).replace(/[^\d]/g, '')) || 0

    pushItem({
      idx,
      title,
      link,
      description,
      pubDate,
      author,
      media,
      engagement: traffic ? { approx_traffic: traffic } : {},
      raw: { trafficRaw },
    })
  })

  $('entry').each((idx, el) => {
    const node = $(el)
    const title = node.find('title').first().text().trim()
    const link =
      node.find('link[rel="alternate"]').attr('href') ||
      node.find('link').attr('href') ||
      node.find('id').first().text().trim() ||
      null
    const description =
      node.find('summary').first().text().trim() ||
      node.find('content').first().text().trim()
    const pubDate =
      node.find('published').first().text().trim() ||
      node.find('updated').first().text().trim()
    const author = node.find('author name').first().text().trim() || null
    const media: Array<{ url: string; type?: string }> = []
    const thumb = node.find('media\\:thumbnail').attr('url')
    if (thumb) media.push({ url: thumb, type: 'image' })

    pushItem({
      idx: items.length + idx,
      title,
      link,
      description,
      pubDate,
      author,
      media,
      engagement: {},
      raw: { atom: true },
    })
  })

  return items
}
