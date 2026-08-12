import { firstEnv } from '../importados-sync/env.js'
import { consumeBudget, getRemainingBudget } from './quota.js'
import { fetchJson, fetchText, parseRssItems, sleep } from './http.js'
import {
  buildGoogleNewsFeeds,
  itemPassesTaskFilters,
  type NormalizedTrendItem,
  type TrendSearchTask,
  type TrendSourceId,
} from './types.js'

type RedditTokenCache = { token: string; expiresAt: number }
let redditToken: RedditTokenCache | null = null

async function getRedditToken(): Promise<string | null> {
  const clientId = firstEnv(['REDDIT_CLIENT_ID'])
  const clientSecret = firstEnv(['REDDIT_CLIENT_SECRET'])
  if (!clientId || !clientSecret) return null
  if (redditToken && redditToken.expiresAt > Date.now() + 30_000) return redditToken.token

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
  })
  const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': firstEnv(['REDDIT_USER_AGENT']) || 'NOTMID-BRAIN-Trends/1.0 by Montion',
    },
    body,
  })
  if (!resp.ok) throw new Error(`Reddit auth ${resp.status}`)
  const json = (await resp.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) return null
  redditToken = {
    token: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  }
  return redditToken.token
}

export async function fetchReddit(task: TrendSearchTask, maxItems: number): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('reddit')
  if (remaining <= 0) return []
  const token = await getRedditToken()
  if (!token) return []

  const ua = firstEnv(['REDDIT_USER_AGENT']) || 'NOTMID-BRAIN-Trends/1.0 by Montion'
  const out: NormalizedTrendItem[] = []
  const subs = task.config.subreddits.slice(0, 5)
  const keywords = task.config.keywords.slice(0, 3)
  let spent = 0

  for (const sub of subs) {
    if (out.length >= maxItems || spent >= remaining) break
    const url = `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/hot?limit=15`
    const data = await fetchJson<{
      data?: { children?: Array<{ data?: Record<string, unknown> }> }
    }>(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua },
    })
    spent += 1
    for (const child of data.data?.children ?? []) {
      const d = child.data ?? {}
      const id = String(d.id ?? '')
      if (!id) continue
      const title = String(d.title ?? '')
      const permalink = String(d.permalink ?? '')
      out.push({
        source: 'reddit',
        externalId: `reddit:${id}`,
        url: permalink ? `https://www.reddit.com${permalink}` : null,
        title,
        body: String(d.selftext ?? '').slice(0, 2000),
        author: d.author ? String(d.author) : null,
        publishedAt: d.created_utc
          ? new Date(Number(d.created_utc) * 1000).toISOString()
          : null,
        media: d.thumbnail && String(d.thumbnail).startsWith('http')
          ? [{ url: String(d.thumbnail), type: 'image' }]
          : [],
        engagement: {
          score: Number(d.score) || 0,
          comments: Number(d.num_comments) || 0,
          upvote_ratio: Math.round((Number(d.upvote_ratio) || 0) * 100),
        },
        raw: { subreddit: sub },
      })
    }
    await sleep(300)
  }

  for (const kw of keywords) {
    if (out.length >= maxItems || spent >= remaining) break
    const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(kw)}&sort=hot&limit=10&t=day`
    const data = await fetchJson<{
      data?: { children?: Array<{ data?: Record<string, unknown> }> }
    }>(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua },
    })
    spent += 1
    for (const child of data.data?.children ?? []) {
      const d = child.data ?? {}
      const id = String(d.id ?? '')
      if (!id) continue
      out.push({
        source: 'reddit',
        externalId: `reddit:${id}`,
        url: d.permalink ? `https://www.reddit.com${String(d.permalink)}` : null,
        title: String(d.title ?? ''),
        body: String(d.selftext ?? '').slice(0, 2000),
        author: d.author ? String(d.author) : null,
        publishedAt: d.created_utc
          ? new Date(Number(d.created_utc) * 1000).toISOString()
          : null,
        media: [],
        engagement: {
          score: Number(d.score) || 0,
          comments: Number(d.num_comments) || 0,
        },
        raw: { query: kw },
      })
    }
    await sleep(300)
  }

  await consumeBudget('reddit', Math.max(1, spent))
  return out.slice(0, maxItems)
}

export async function fetchYoutube(task: TrendSearchTask, maxItems: number): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('youtube')
  if (remaining <= 0) return []
  const out: NormalizedTrendItem[] = []
  let spent = 0

  for (const channelId of task.config.youtube_channel_ids.slice(0, 5)) {
    if (out.length >= maxItems) break
    const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
    try {
      const xml = await fetchText(feed)
      const items = parseRssItems(xml, 'youtube').map((item) => ({
        ...item,
        externalId: item.externalId.replace(/^rss:/, 'youtube:'),
        source: 'youtube' as const,
      }))
      out.push(...items)
      spent += 1
    } catch {
      // canal inválido / feed caído
    }
  }

  const apiKey = firstEnv(['YOUTUBE_API_KEY', 'GOOGLE_API_KEY'])
  if (apiKey && spent < remaining) {
    for (const kw of task.config.keywords.slice(0, 2)) {
      if (out.length >= maxItems || spent >= Math.min(remaining, 20)) break
      const url =
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=8` +
        `&q=${encodeURIComponent(kw)}&key=${encodeURIComponent(apiKey)}`
      try {
        const data = await fetchJson<{
          items?: Array<{
            id?: { videoId?: string }
            snippet?: {
              title?: string
              description?: string
              channelTitle?: string
              publishedAt?: string
              thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
            }
          }>
        }>(url)
        spent += 1
        for (const item of data.items ?? []) {
          const vid = item.id?.videoId
          if (!vid) continue
          const sn = item.snippet ?? {}
          const thumb =
            sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || null
          out.push({
            source: 'youtube',
            externalId: `youtube:${vid}`,
            url: `https://www.youtube.com/watch?v=${vid}`,
            title: sn.title || '(video)',
            body: (sn.description || '').slice(0, 2000),
            author: sn.channelTitle || null,
            publishedAt: sn.publishedAt || null,
            media: thumb ? [{ url: thumb, type: 'image' }] : [],
            engagement: {},
            raw: { query: kw },
          })
        }
      } catch {
        break
      }
      await sleep(200)
    }
  }

  if (spent > 0) await consumeBudget('youtube', spent)
  return out.slice(0, maxItems)
}

export async function fetchRss(task: TrendSearchTask, maxItems: number): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('rss')
  if (remaining <= 0) return []
  const out: NormalizedTrendItem[] = []
  let spent = 0

  const newsQueries =
    task.config.news_queries.length > 0
      ? task.config.news_queries
      : task.config.keywords.slice(0, 3)
  const autoNews = buildGoogleNewsFeeds(newsQueries, task.config.trends_geos)
  const feeds = [...task.config.rss_feeds, ...autoNews].slice(0, 12)

  for (const feed of feeds) {
    if (out.length >= maxItems || spent >= remaining) break
    try {
      const xml = await fetchText(feed)
      const items = parseRssItems(xml, 'rss')
      out.push(...items)
      spent += 1
    } catch {
      // feed caído
    }
    await sleep(150)
  }
  if (spent > 0) await consumeBudget('rss', spent)
  return out.slice(0, maxItems)
}

export async function fetchGoogleTrendsRss(
  task: TrendSearchTask,
  maxItems: number,
): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('gtrends_rss')
  if (remaining <= 0) return []
  const out: NormalizedTrendItem[] = []
  let spent = 0
  const geos = task.config.trends_geos.length ? task.config.trends_geos : ['AR', 'US']

  for (const geo of geos.slice(0, 4)) {
    if (out.length >= maxItems || spent >= remaining) break
    const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`
    try {
      const xml = await fetchText(url)
      let items = parseRssItems(xml, 'gtrends_rss').map((item) => ({
        ...item,
        externalId: `gtrends:${geo}:${item.title.toLowerCase()}`,
        raw: { ...item.raw, geo },
      }))
      const terms = [
        ...task.config.keywords,
        ...task.config.must_include,
        ...task.config.news_queries,
        ...task.config.bluesky_queries,
      ]
        .map((k) => k.toLowerCase())
        .filter(Boolean)

      // Solo tendencias que matchean la búsqueda. Nunca top genérico del país.
      if (!terms.length) {
        items = []
      } else {
        items = items.filter((it) => {
          const hay = `${it.title} ${it.body}`.toLowerCase()
          return terms.some((k) => hay.includes(k))
        })
      }
      out.push(...items)
      spent += 1
    } catch {
      // trends rss caído
    }
    await sleep(200)
  }
  if (spent > 0) await consumeBudget('gtrends_rss', spent)
  return out.slice(0, maxItems)
}

export async function fetchHackerNews(task: TrendSearchTask, maxItems: number): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('hn')
  if (remaining <= 0) return []
  const out: NormalizedTrendItem[] = []
  let spent = 0
  const queries = task.config.keywords.slice(0, 3)
  for (const q of queries) {
    if (out.length >= maxItems || spent >= remaining) break
    const url =
      `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=12&query=${encodeURIComponent(q)}`
    try {
      const data = await fetchJson<{
        hits?: Array<{
          objectID?: string
          title?: string
          url?: string
          author?: string
          created_at?: string
          points?: number
          num_comments?: number
          story_text?: string
        }>
      }>(url)
      spent += 1
      for (const hit of data.hits ?? []) {
        const id = hit.objectID
        if (!id) continue
        out.push({
          source: 'hn',
          externalId: `hn:${id}`,
          url: hit.url || `https://news.ycombinator.com/item?id=${id}`,
          title: hit.title || '(hn)',
          body: (hit.story_text || '').slice(0, 2000),
          author: hit.author || null,
          publishedAt: hit.created_at || null,
          media: [],
          engagement: {
            points: Number(hit.points) || 0,
            comments: Number(hit.num_comments) || 0,
          },
          raw: { query: q },
        })
      }
    } catch {
      break
    }
  }
  if (spent > 0) await consumeBudget('hn', spent)
  return out.slice(0, maxItems)
}

export async function fetchBluesky(task: TrendSearchTask, maxItems: number): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('bluesky')
  if (remaining <= 0) return []
  const out: NormalizedTrendItem[] = []
  let spent = 0
  const queries = (task.config.bluesky_queries.length
    ? task.config.bluesky_queries
    : task.config.keywords
  ).slice(0, 3)

  for (const q of queries) {
    if (out.length >= maxItems || spent >= remaining) break
    const url =
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=15`
    try {
      const data = await fetchJson<{
        posts?: Array<{
          uri?: string
          cid?: string
          author?: { handle?: string; displayName?: string }
          record?: { text?: string; createdAt?: string }
          likeCount?: number
          repostCount?: number
          replyCount?: number
          embed?: { images?: Array<{ fullsize?: string; thumb?: string }> }
        }>
      }>(url)
      spent += 1
      for (const post of data.posts ?? []) {
        const uri = post.uri || ''
        if (!uri) continue
        const rkey = uri.split('/').pop() || uri
        const handle = post.author?.handle || 'unknown'
        const text = post.record?.text || ''
        const images =
          post.embed?.images?.map((img) => ({
            url: img.fullsize || img.thumb || '',
            type: 'image',
          })).filter((m) => m.url) ?? []
        out.push({
          source: 'bluesky',
          externalId: `bsky:${uri}`,
          url: `https://bsky.app/profile/${handle}/post/${rkey}`,
          title: text.slice(0, 120) || `(post @${handle})`,
          body: text.slice(0, 2000),
          author: post.author?.displayName || handle,
          publishedAt: post.record?.createdAt || null,
          media: images,
          engagement: {
            likes: Number(post.likeCount) || 0,
            reposts: Number(post.repostCount) || 0,
            replies: Number(post.replyCount) || 0,
          },
          raw: { query: q, cid: post.cid },
        })
      }
    } catch {
      break
    }
    await sleep(200)
  }
  if (spent > 0) await consumeBudget('bluesky', spent)
  return out.slice(0, maxItems)
}

export async function fetchArxiv(task: TrendSearchTask, maxItems: number): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('arxiv')
  if (remaining <= 0) return []
  if (!task.config.sources_enabled.includes('arxiv')) return []
  const q = encodeURIComponent(task.config.keywords.slice(0, 2).join(' OR ') || 'artificial intelligence')
  const url = `https://export.arxiv.org/api/query?search_query=all:${q}&sortBy=submittedDate&sortOrder=descending&max_results=10`
  try {
    const xml = await fetchText(url)
    const items = parseRssItems(xml, 'arxiv').map((item) => ({
      ...item,
      source: 'arxiv' as const,
      externalId: `arxiv:${item.url || item.title}`,
    }))
    await consumeBudget('arxiv', 1)
    return items.slice(0, maxItems)
  } catch {
    return []
  }
}

export async function fetchLobsters(task: TrendSearchTask, maxItems: number): Promise<NormalizedTrendItem[]> {
  const remaining = await getRemainingBudget('lobsters')
  if (remaining <= 0) return []
  if (!task.config.sources_enabled.includes('lobsters')) return []
  try {
    const data = await fetchJson<
      Array<{
        short_id?: string
        title?: string
        url?: string
        description?: string
        created_at?: string
        score?: number
        comment_count?: number
        submitter_user?: string
      }>
    >('https://lobste.rs/hottest.json')
    await consumeBudget('lobsters', 1)
    const keywords = task.config.keywords.map((k) => k.toLowerCase())
    return data
      .filter((row) => {
        if (!keywords.length) return true
        const hay = `${row.title ?? ''} ${row.description ?? ''}`.toLowerCase()
        return keywords.some((k) => hay.includes(k))
      })
      .slice(0, maxItems)
      .map((row) => ({
        source: 'lobsters' as const,
        externalId: `lobsters:${row.short_id}`,
        url: row.url || `https://lobste.rs/s/${row.short_id}`,
        title: row.title || '(lobsters)',
        body: (row.description || '').slice(0, 2000),
        author: row.submitter_user || null,
        publishedAt: row.created_at || null,
        media: [],
        engagement: {
          score: Number(row.score) || 0,
          comments: Number(row.comment_count) || 0,
        },
        raw: {},
      }))
  } catch {
    return []
  }
}

export async function collectForTask(
  task: TrendSearchTask,
  perSourceCap = 20,
): Promise<NormalizedTrendItem[]> {
  const enabled = new Set(task.config.sources_enabled)
  const jobs: Array<Promise<NormalizedTrendItem[]>> = []

  const run = (id: TrendSourceId, fn: () => Promise<NormalizedTrendItem[]>) => {
    if (enabled.has(id)) jobs.push(fn().catch(() => []))
  }

  run('reddit', () => fetchReddit(task, perSourceCap))
  run('youtube', () => fetchYoutube(task, perSourceCap))
  run('rss', () => fetchRss(task, perSourceCap))
  run('gtrends_rss', () => fetchGoogleTrendsRss(task, perSourceCap))
  run('hn', () => fetchHackerNews(task, perSourceCap))
  run('bluesky', () => fetchBluesky(task, perSourceCap))
  run('arxiv', () => fetchArxiv(task, Math.min(perSourceCap, 10)))
  run('lobsters', () => fetchLobsters(task, perSourceCap))

  const chunks = await Promise.all(jobs)
  const merged = chunks.flat()
  const seen = new Set<string>()
  const unique: NormalizedTrendItem[] = []
  for (const item of merged) {
    if (seen.has(item.externalId)) continue
    if (!itemPassesTaskFilters(item, task.config)) continue
    seen.add(item.externalId)
    unique.push(item)
  }
  return unique
}
