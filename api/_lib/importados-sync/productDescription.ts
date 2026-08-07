import * as cheerio from 'cheerio'
import { fetchWithTimeout } from './providers/types.js'

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'br',
  'tr',
  'td',
  'th',
  'blockquote',
  'section',
  'article',
])

/** Limpia HTML del proveedor: sin scripts ni basura; conserva títulos, listas, negritas, saltos. */
export function sanitizePublicProductHtml(html: string): string {
  const raw = (html || '').trim()
  if (!raw) return ''

  const $ = cheerio.load(raw, undefined, false)
  $('script, style, noscript, iframe, svg, form, input, button').remove()

  // Banners del proveedor: hotlinkean su CDN y suelen mostrar otros colores del
  // producto que nosotros no vendemos. La descripción va solo con texto.
  $('img, picture, source, video, figure').remove()

  // Links → solo texto (sin hipervínculo a la página del proveedor u otros)
  $('a').each((_, el) => {
    const $a = $(el)
    $a.replaceWith($a.contents())
  })

  $('*').each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs
    if (!attribs) return
    for (const name of Object.keys(attribs)) {
      if (
        name.startsWith('on') ||
        name === 'style' ||
        name === 'class' ||
        name === 'id' ||
        name === 'href' ||
        name === 'srcset'
      ) {
        $(el).removeAttr(name)
      }
    }
  })

  // Contenedores que quedaron vacíos al sacar los banners
  $('p, div, li, figure, section').each((_, el) => {
    const $el = $(el)
    if ($el.find('br, img, video').length) return
    if (!$el.text().trim()) $el.remove()
  })

  const body = $('body')
  const inner = (body.length ? body.html() : $.root().html()) || ''
  // No aplastar a una sola línea: preserva saltos que el theme pueda respetar
  return inner.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function looksMostlySpanish(text: string): boolean {
  const sample = text.slice(0, 800).toLowerCase()
  const hits = (
    sample.match(
      /\b(el|la|los|las|de|del|para|con|una|este|esta|teclado|mouse|switch|incluye|características|garantía)\b/gi,
    ) || []
  ).length
  const hasAccents = /[áéíóúñü¿¡]/i.test(sample)
  return hasAccents || hits >= 4
}

async function translateChunkEnToEs(chunk: string): Promise<string> {
  const q = chunk.trim()
  if (!q) return ''
  if (q.length <= 2) return q

  // MyMemory ~450 chars; trocear frases largas y unir
  if (q.length > 420) {
    const parts = q.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [q]
    const out: string[] = []
    let buf = ''
    for (const part of parts) {
      const next = `${buf} ${part}`.trim()
      if (next.length > 400 && buf) {
        out.push(await translateChunkEnToEs(buf))
        buf = part.trim()
      } else {
        buf = next
      }
    }
    if (buf) out.push(await translateChunkEnToEs(buf))
    return out.join(' ').replace(/\s+/g, ' ').trim()
  }

  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|es`
  try {
    const resp = await fetchWithTimeout(url, { method: 'GET' }, 10_000)
    if (!resp.ok) return q
    const json = (await resp.json()) as {
      responseData?: { translatedText?: string }
    }
    const translated = (json.responseData?.translatedText || '').trim()
    if (!translated || /MYMEMORY WARNING/i.test(translated)) return q
    // Evitar basura HTML entities dobles del traductor
    return translated
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  } catch {
    return q
  }
}

type DomNode = {
  type?: string
  name?: string
  data?: string
  children?: DomNode[]
}

function collectTranslatableTextNodes(root: DomNode | null | undefined): DomNode[] {
  const nodes: DomNode[] = []

  function walk(node: DomNode | undefined) {
    if (!node) return
    if (node.type === 'text') {
      const raw = node.data ?? ''
      if (raw.trim().length >= 2) nodes.push(node)
      return
    }
    if (node.type === 'tag') {
      const name = (node.name || '').toLowerCase()
      if (name === 'script' || name === 'style' || name === 'noscript') return
      for (const child of node.children ?? []) walk(child)
      return
    }
    if (node.type === 'root') {
      for (const child of node.children ?? []) walk(child)
    }
  }

  walk(root ?? undefined)
  return nodes
}

/**
 * Traduce solo nodos de texto; deja intactos <p>, <ul>, <li>, <strong>, <br>, títulos, etc.
 */
async function translateHtmlPreservingMarkup(html: string): Promise<string> {
  const $ = cheerio.load(`<div id="nm-root">${html}</div>`, undefined, false)
  const rootEl = $('#nm-root').get(0) as DomNode | undefined
  if (!rootEl) return html

  const textNodes = collectTranslatableTextNodes(rootEl)
  // Cap de llamadas al traductor por producto
  const limit = Math.min(textNodes.length, 48)

  for (let i = 0; i < limit; i += 1) {
    const node = textNodes[i]
    const original = node.data ?? ''
    const leading = original.match(/^\s*/)?.[0] ?? ''
    const trailing = original.match(/\s*$/)?.[0] ?? ''
    const core = original.trim()
    if (!core) continue
    const translated = await translateChunkEnToEs(core)
    node.data = `${leading}${translated}${trailing}`
  }

  return $('#nm-root').html() || html
}

function ensureReadableBlocks(html: string): string {
  const trimmed = (html || '').trim()
  if (!trimmed) return ''
  // Si el proveedor mandó texto casi plano con \n, convertir saltos a <br>
  if (!/<[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line}</p>`)
      .join('')
  }
  // Si hay bloques pero faltan <br> entre líneas sueltas dentro de un div, no forzar.
  void BLOCK_TAGS
  return trimmed
}

/** Traduce descripción EN→ES preservando el HTML (best effort). */
export async function publicProductDescriptionHtml(rawHtml: string): Promise<string> {
  const cleaned = ensureReadableBlocks(sanitizePublicProductHtml(rawHtml))
  if (!cleaned) return ''

  const $ = cheerio.load(`<div id="probe">${cleaned}</div>`, undefined, false)
  const plain = $('#probe').text().replace(/\s+/g, ' ').trim()
  if (!plain) return ''

  if (looksMostlySpanish(plain)) {
    return cleaned
  }

  try {
    return await translateHtmlPreservingMarkup(cleaned)
  } catch {
    return cleaned
  }
}
