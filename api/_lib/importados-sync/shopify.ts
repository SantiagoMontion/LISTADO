import { getShopifyEnv } from './env.js'

type ShopifyJson = Record<string, unknown>

let cachedLocationId: string | null = null
let cachedImportadosCollectionId: string | null = null

const IMPORTADOS_COLLECTION_TITLE = 'IMPORTADOS'

function adminBaseUrl(): string {
  const { domain, apiVersion } = getShopifyEnv()
  return `https://${domain}/admin/api/${apiVersion}`
}

async function shopifyFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; json: ShopifyJson | null; text: string }> {
  const { token } = getShopifyEnv()
  const url = path.startsWith('http') ? path : `${adminBaseUrl()}/${path.replace(/^\//, '')}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const resp = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Shopify-Access-Token': token,
        ...(init.headers ?? {}),
      },
    })

    const text = await resp.text()
    let json: ShopifyJson | null = null
    try {
      json = text ? (JSON.parse(text) as ShopifyJson) : null
    } catch {
      json = null
    }

    return { ok: resp.ok, status: resp.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

function extractNumericId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const gidMatch = trimmed.match(/\/(\d+)\s*$/)
  if (gidMatch) return gidMatch[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return null
}

type ShopifyCollection = {
  id?: number | string
  title?: string
  handle?: string
}

function isImportadosCollection(collection: ShopifyCollection): boolean {
  return (
    collection.title?.trim().toLocaleUpperCase() === IMPORTADOS_COLLECTION_TITLE ||
    collection.handle?.trim().toLowerCase() === 'importados'
  )
}

async function resolveImportadosManualCollectionId(): Promise<string> {
  if (cachedImportadosCollectionId) return cachedImportadosCollectionId

  const custom = await shopifyFetch(
    'custom_collections.json?limit=250&fields=id,title,handle',
  )
  if (!custom.ok) {
    throw new Error(
      `No pude buscar la colección IMPORTADOS (${custom.status}): ${custom.text.slice(0, 200)}`,
    )
  }

  const customCollections =
    (custom.json?.custom_collections as ShopifyCollection[] | undefined) ?? []
  const match = customCollections.find(isImportadosCollection)
  const id = extractNumericId(match?.id)
  if (id) {
    cachedImportadosCollectionId = id
    return id
  }

  // Una colección automatizada no acepta altas manuales con /collects. Damos un
  // error explícito para no dejar un producto creado fuera de IMPORTADOS.
  const smart = await shopifyFetch(
    'smart_collections.json?limit=250&fields=id,title,handle',
  )
  const smartCollections =
    (smart.json?.smart_collections as ShopifyCollection[] | undefined) ?? []
  if (smart.ok && smartCollections.some(isImportadosCollection)) {
    throw new Error(
      'La colección IMPORTADOS es automatizada. Convertíla en manual o configurá su regla para la etiqueta IMPORTADOS.',
    )
  }

  throw new Error(
    'No encontré una colección manual llamada IMPORTADOS en Shopify.',
  )
}

async function addProductToImportadosCollection(productId: string): Promise<void> {
  const collectionId = await resolveImportadosManualCollectionId()
  const result = await shopifyFetch('collects.json', {
    method: 'POST',
    body: JSON.stringify({
      collect: {
        product_id: Number(productId),
        collection_id: Number(collectionId),
      },
    }),
  })

  if (!result.ok) {
    throw new Error(
      `No pude agregar el producto a la colección IMPORTADOS (${result.status}): ${result.text.slice(0, 200)}`,
    )
  }
}

export async function resolveLocationId(): Promise<string> {
  const configured = getShopifyEnv().locationId
  if (configured) {
    const id = extractNumericId(configured)
    if (!id) throw new Error(`Invalid SHOPIFY_LOCATION_ID: ${configured}`)
    return id
  }

  if (cachedLocationId) return cachedLocationId

  const { ok, status, json, text } = await shopifyFetch('locations.json')
  if (!ok) {
    throw new Error(`Shopify locations.json failed (${status}): ${text.slice(0, 300)}`)
  }

  const locations = (json?.locations as Array<{ id?: number; active?: boolean }> | undefined) ?? []
  const active = locations.find((loc) => loc.active !== false) ?? locations[0]
  const id = extractNumericId(active?.id)
  if (!id) throw new Error('Shopify returned no usable location id')

  cachedLocationId = id
  return id
}

export async function getVariantInventoryItemId(variantId: string): Promise<string> {
  const numericVariantId = extractNumericId(variantId)
  if (!numericVariantId) throw new Error(`Invalid Shopify variant id: ${variantId}`)

  const { ok, status, json, text } = await shopifyFetch(`variants/${numericVariantId}.json`)
  if (!ok) {
    throw new Error(
      `Shopify variants/${numericVariantId}.json failed (${status}): ${text.slice(0, 300)}`,
    )
  }

  const variant = json?.variant as { inventory_item_id?: number | string } | undefined
  const inventoryItemId = extractNumericId(variant?.inventory_item_id)
  if (!inventoryItemId) {
    throw new Error(`Variant ${numericVariantId} has no inventory_item_id`)
  }

  return inventoryItemId
}

/** Product id de NotMid a partir de un variant id (para link de admin). */
export async function getProductIdFromVariant(variantId: string): Promise<string> {
  const numericVariantId = extractNumericId(variantId)
  if (!numericVariantId) throw new Error(`Invalid Shopify variant id: ${variantId}`)

  const { ok, status, json, text } = await shopifyFetch(`variants/${numericVariantId}.json`)
  if (!ok) {
    throw new Error(
      `Shopify variants/${numericVariantId}.json failed (${status}): ${text.slice(0, 300)}`,
    )
  }

  const variant = json?.variant as { product_id?: number | string } | undefined
  const productId = extractNumericId(variant?.product_id)
  if (!productId) {
    throw new Error(`Variant ${numericVariantId} has no product_id`)
  }
  return productId
}

export function shopifyAdminProductUrl(productId: string): string {
  const { domain } = getShopifyEnv()
  const storeHandle = domain.replace(/\.myshopify\.com$/i, '')
  return `https://admin.shopify.com/store/${storeHandle}/products/${productId}`
}

export async function setVariantInventoryAvailable(
  variantId: string,
  available: number,
): Promise<void> {
  const inventoryItemId = await getVariantInventoryItemId(variantId)
  const locationId = await resolveLocationId()
  const qty = Math.max(0, Math.trunc(Number(available) || 0))

  const body = JSON.stringify({
    location_id: Number(locationId),
    inventory_item_id: Number(inventoryItemId),
    available: qty,
  })

  const { ok, status, text } = await shopifyFetch('inventory_levels/set.json', {
    method: 'POST',
    body,
  })

  if (!ok) {
    throw new Error(
      `Shopify inventory_levels/set failed for variant ${variantId} (${status}): ${text.slice(0, 400)}`,
    )
  }
}

export async function setVariantInventoryToZero(variantId: string): Promise<void> {
  await setVariantInventoryAvailable(variantId, 0)
}

export type CreateNotmidVariantInput = {
  option1: string
  option2?: string | null
  option3?: string | null
  sku: string | null
  price: number
  inventoryQuantity: number
  supplierVariantId: string
}

export type CreateNotmidProductInput = {
  title: string
  bodyHtml: string
  vendor: string
  /** Precio ARS contado (mismo para todas las variantes si el proveedor no varía). */
  price: number
  options: Array<{ name: string; values: string[] }>
  variants: CreateNotmidVariantInput[]
  imageUrls: string[]
  /** option1 → URL de la foto featured real del proveedor */
  variantFeaturedImageByOption?: Record<string, string>
  /** @deprecated usar variantFeaturedImageByOption */
  imageOptionByUrl?: Record<string, string>
  sourceUrl: string
  provider: string
  tags?: string[]
}

export type CreatedVariantMapEntry = {
  supplierVariantId: string
  option: string
  notmidVariantId: string
  sku: string | null
}

export type CreatedNotmidProduct = {
  productId: string
  /** Primera variante (compat). */
  variantId: string
  adminUrl: string
  title: string
  price: number
  imagesAttached: number
  imageWarnings: string[]
  variantMap: CreatedVariantMapEntry[]
}

function normalizeImageUrl(raw: string, baseUrl?: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:')) return null
  try {
    if (trimmed.startsWith('//')) return `https:${trimmed}`
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (baseUrl) return new URL(trimmed, baseUrl).toString()
    return null
  } catch {
    return null
  }
}

function imageMatchKey(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.hostname}${u.pathname}`.toLowerCase()
  } catch {
    return raw.toLowerCase().split('?')[0] || raw.toLowerCase()
  }
}

/** Nombre de archivo sin query ni sufijos de tamaño Shopify. */
function imageBasename(raw: string): string {
  try {
    const path = new URL(raw).pathname
    const file = decodeURIComponent(path.split('/').pop() || '')
    return file
      .toLowerCase()
      .replace(
        /_(?:\d+x\d+|\d+x|x\d+|pico|icon|thumb|small|compact|medium|large|grande|1024x1024|2048x2048|master)(?=\.[a-z0-9]+$)/i,
        '',
      )
  } catch {
    return raw.toLowerCase().split('/').pop()?.split('?')[0] || raw.toLowerCase()
  }
}

function sameImage(a: string, b: string): boolean {
  if (imageMatchKey(a) === imageMatchKey(b)) return true
  const ba = imageBasename(a)
  const bb = imageBasename(b)
  return Boolean(ba && bb && ba === bb)
}

/**
 * El CDN de Shopify negocia por Accept: si pedimos avif/webp devuelve ese formato
 * aunque la URL termine en .jpg. Nos quedamos siempre en JPEG/PNG porque son los
 * únicos que decodifican igual en cualquier build de sharp.
 */
const SUPPLIER_IMAGE_ACCEPT = 'image/jpeg,image/png,image/*;q=0.8'

/**
 * Máxima calidad del CDN Shopify: quita transforms de tamaño del path
 * y evita pedir width/height reducidos.
 */
function maximizeShopifyCdnUrl(imageUrl: string): string {
  try {
    const u = new URL(imageUrl)
    u.pathname = u.pathname.replace(
      /_(?:\d+x\d+|\d+x|x\d+|pico|icon|thumb|small|compact|medium|large|grande|1024x1024|2048x2048|master)(?=\.[a-z0-9]+$)/i,
      '',
    )
    u.searchParams.delete('width')
    u.searchParams.delete('height')
    u.searchParams.delete('crop')
    u.searchParams.delete('format')
    return u.toString()
  } catch {
    return imageUrl
  }
}

async function downloadSquareJpegBase64(
  imageUrl: string,
): Promise<{ attachment: string; filename: string } | null> {
  try {
    const candidates = [maximizeShopifyCdnUrl(imageUrl)]
    try {
      const u = new URL(candidates[0])
      if (u.hostname.includes('shopify')) {
        const withFormat = new URL(u.toString())
        withFormat.searchParams.set('format', 'jpg')
        candidates.push(withFormat.toString())
        u.searchParams.set('width', '2048')
        candidates.push(u.toString())
      }
    } catch {
      // ignore
    }

    let input: Buffer | null = null
    for (const fetchUrl of candidates) {
      const resp = await fetch(fetchUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: SUPPLIER_IMAGE_ACCEPT,
          Referer: new URL(imageUrl).origin + '/',
        },
        signal: AbortSignal.timeout(25_000),
      })
      if (!resp.ok) continue
      const contentType = (resp.headers.get('content-type') || '').toLowerCase()
      if (contentType && !contentType.startsWith('image/')) continue
      // avif/webp/heif decodifican distinto según el build de sharp y pueden salir
      // con los colores rotos; si el CDN los manda igual, probamos el próximo candidato.
      if (/avif|webp|heif|heic/.test(contentType)) continue
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length < 100 || buf.length > 25_000_000) continue
      input = buf
      break
    }
    if (!input) return null

    const sharp = (await import('sharp')).default
    const squared = await sharp(input)
      .rotate()
      .toColourspace('srgb')
      .resize(1600, 1600, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        position: 'centre',
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer()

    return {
      attachment: squared.toString('base64'),
      filename: `importados-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`,
    }
  } catch {
    return null
  }
}

async function uploadProductImage(params: {
  productId: string
  imageUrl: string
  variantIds?: number[]
}): Promise<{ imageId: string | null; warning?: string }> {
  const downloaded = await downloadSquareJpegBase64(params.imageUrl)
  if (!downloaded) {
    return { imageId: null, warning: `No pude descargar imagen: ${params.imageUrl.slice(0, 100)}` }
  }

  const imagePayload: Record<string, unknown> = {
    attachment: downloaded.attachment,
    filename: downloaded.filename,
  }
  if (params.variantIds?.length) {
    imagePayload.variant_ids = params.variantIds
  }

  const { ok, status, json, text } = await shopifyFetch(
    `products/${params.productId}/images.json`,
    {
      method: 'POST',
      body: JSON.stringify({ image: imagePayload }),
    },
  )
  if (!ok) {
    return {
      imageId: null,
      warning: `Shopify rechazó una imagen (${status}): ${text.slice(0, 160)}`,
    }
  }

  const imageId = extractNumericId(
    (json?.image as { id?: number | string } | undefined)?.id,
  )
  return { imageId }
}

async function attachAllImages(params: {
  productId: string
  imageUrls: string[]
  sourceUrl: string
  variantFeaturedImageByOption: Record<string, string>
  optionToVariantId: Record<string, string[]>
}): Promise<{ attached: number; warnings: string[] }> {
  const warnings: string[] = []
  let attached = 0

  const gallery = params.imageUrls
    .map((u) => normalizeImageUrl(u, params.sourceUrl))
    .filter((u): u is string => Boolean(u))

  // Dedup por basename, conservando orden de galería del proveedor
  const unique: string[] = []
  for (const url of gallery) {
    if (unique.some((u) => sameImage(u, url))) continue
    unique.push(url)
    if (unique.length >= 24) break
  }

  const featuredEntries = Object.entries(params.variantFeaturedImageByOption)
    .map(([option, raw]) => {
      const url = normalizeImageUrl(raw, params.sourceUrl)
      const variantIds = params.optionToVariantId[option.trim().toLowerCase()] ?? []
      return url && variantIds.length ? { option, url, variantIds } : null
    })
    .filter((e): e is { option: string; url: string; variantIds: string[] } => Boolean(e))

  const assignedOptions = new Set<string>()

  async function setVariantImage(
    variantId: string,
    imageId: string,
    option: string,
  ): Promise<void> {
    const { ok, status, text } = await shopifyFetch(`variants/${variantId}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        variant: { id: Number(variantId), image_id: Number(imageId) },
      }),
    })
    if (!ok) {
      warnings.push(
        `No pude fijar imagen featured de «${option}» (${status}): ${text.slice(0, 120)}`,
      )
    }
  }

  for (const url of unique) {
    const matched = featuredEntries.filter((e) => sameImage(e.url, url))
    const variantIds = matched.flatMap((e) => e.variantIds.map(Number))

    const result = await uploadProductImage({
      productId: params.productId,
      imageUrl: url,
      variantIds: variantIds.length ? variantIds : undefined,
    })
    if (result.warning) warnings.push(result.warning)
    if (!result.imageId) continue
    attached += 1

    // Fijar image_id en cada variante cuya featured es esta foto
    for (const entry of matched) {
      assignedOptions.add(entry.option)
      for (const variantId of entry.variantIds) {
        await setVariantImage(variantId, result.imageId, entry.option)
      }
    }
  }

  // Si alguna featured no estaba en la galería, subirla aparte
  for (const entry of featuredEntries) {
    if (assignedOptions.has(entry.option)) continue
    const result = await uploadProductImage({
      productId: params.productId,
      imageUrl: entry.url,
      variantIds: entry.variantIds.map(Number),
    })
    if (result.warning) warnings.push(result.warning)
    if (!result.imageId) {
      warnings.push(`No pude subir la foto de frente de «${entry.option}»`)
      continue
    }
    attached += 1
    for (const variantId of entry.variantIds) {
      await setVariantImage(variantId, result.imageId, entry.option)
    }
  }

  return { attached, warnings }
}

type VariantRow = {
  /** Valor por eje de opción, ya garantizado único entre variantes. */
  values: string[]
  /** Etiqueta completa, igual al title que arma Shopify («Black / Size 1»). */
  label: string
  source: CreateNotmidVariantInput
}

type VariantAxes = {
  optionNames: string[]
  rows: VariantRow[]
}

/**
 * Shopify rechaza el producto entero si dos variantes comparten la misma
 * combinación de opciones («The variant 'Black' already exists»). Muchos
 * productos repiten el color y se diferencian por talle, así que mandamos los
 * ejes reales del proveedor y, si aun así quedan choques, los desempatamos.
 */
export function buildVariantAxes(
  variants: CreateNotmidVariantInput[],
  optionNamesFromSupplier: Array<{ name: string }>,
): VariantAxes {
  const clean = (value: string | null | undefined): string => (value ?? '').trim()

  // Solo usamos un eje extra si TODAS las variantes lo tienen: Shopify exige un
  // valor por eje declarado en cada variante.
  const usesOption2 = variants.every((v) => clean(v.option2))
  const usesOption3 = usesOption2 && variants.every((v) => clean(v.option3))

  const optionNames = [optionNamesFromSupplier[0]?.name?.trim() || 'Color']
  if (usesOption2) optionNames.push(optionNamesFromSupplier[1]?.name?.trim() || 'Opción 2')
  if (usesOption3) optionNames.push(optionNamesFromSupplier[2]?.name?.trim() || 'Opción 3')

  const rows: VariantRow[] = []
  const usedLabels = new Set<string>()

  for (const source of variants) {
    const values = [clean(source.option1) || 'Único']
    if (usesOption2) values.push(clean(source.option2))
    if (usesOption3) values.push(clean(source.option3))

    // Último recurso: si la combinación ya existe, numeramos el primer eje para
    // no perder la variante ni romper la creación completa.
    let label = values.join(' / ')
    if (usedLabels.has(label.toLowerCase())) {
      const base = values[0]
      let suffix = 2
      do {
        values[0] = `${base} ${suffix}`
        label = values.join(' / ')
        suffix += 1
      } while (usedLabels.has(label.toLowerCase()))
    }

    usedLabels.add(label.toLowerCase())
    rows.push({ values, label, source })
  }

  return { optionNames, rows }
}

/**
 * Rollback: si después de crear el producto no lo podemos registrar en seguimiento,
 * lo borramos para no dejar borradores huérfanos en Shopify.
 */
export async function deleteNotmidProduct(productId: string): Promise<boolean> {
  const id = extractNumericId(productId)
  if (!id) return false
  try {
    const { ok } = await shopifyFetch(`products/${id}.json`, { method: 'DELETE' })
    return ok
  } catch {
    return false
  }
}

export async function createNotmidProductFromCatalog(
  input: CreateNotmidProductInput,
): Promise<CreatedNotmidProduct> {
  const { domain } = getShopifyEnv()
  const storeHandle = domain.replace(/\.myshopify\.com$/i, '')

  if (!input.variants.length) {
    throw new Error('No hay variantes para crear en Shopify')
  }

  const { optionNames, rows } = buildVariantAxes(input.variants, input.options)

  const options = optionNames.map((name, axis) => ({
    name,
    values: [...new Set(rows.map((row) => row.values[axis]).filter(Boolean))],
  }))

  const payload = {
    product: {
      title: input.title,
      body_html: (input.bodyHtml || '').trim(),
      vendor: input.vendor,
      product_type: 'Importados',
      status: 'draft' as const,
      template_suffix: 'importados',
      tags: ['IMPORTADOS', 'importados-sync', input.provider, ...(input.tags ?? [])].join(', '),
      options,
      variants: rows.map((row) => ({
        option1: row.values[0],
        option2: row.values[1],
        option3: row.values[2],
        sku: row.source.sku || undefined,
        price: Number(row.source.price).toFixed(2),
        inventory_management: 'shopify',
        inventory_policy: 'deny',
      })),
    },
  }

  const { ok, status, json, text } = await shopifyFetch('products.json', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  if (!ok) {
    throw new Error(`Shopify create product failed (${status}): ${text.slice(0, 500)}`)
  }

  const product = json?.product as
    | {
        id?: number | string
        title?: string
        variants?: Array<{
          id?: number | string
          option1?: string
          option2?: string | null
          option3?: string | null
          sku?: string
          inventory_item_id?: number | string
        }>
      }
    | undefined

  const productId = extractNumericId(product?.id)
  if (!productId) throw new Error('Shopify creó el producto pero no devolvió product id')

  try {
    await addProductToImportadosCollection(productId)
  } catch (error) {
    const removed = await deleteNotmidProduct(productId)
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      removed
        ? `${detail} Se canceló la creación en Shopify.`
        : `${detail} No pude borrar el borrador creado; hay que eliminarlo manualmente.`,
    )
  }

  const createdVariants = product?.variants ?? []
  const variantMap: CreatedVariantMapEntry[] = []
  // Un mismo valor (ej. «Black») puede corresponder a varias variantes cuando el
  // proveedor lo cruza con talle, así que guardamos todas.
  const optionToVariantId: Record<string, string[]> = {}

  const rowByLabel = new Map(rows.map((row) => [row.label.toLowerCase(), row]))

  function indexOption(key: string, notmidVariantId: string): void {
    const clean = key.trim().toLowerCase()
    if (!clean) return
    const bucket = optionToVariantId[clean] ?? []
    if (!bucket.includes(notmidVariantId)) bucket.push(notmidVariantId)
    optionToVariantId[clean] = bucket
  }

  for (const created of createdVariants) {
    const notmidVariantId = extractNumericId(created.id)
    if (!notmidVariantId) continue
    const label = [created.option1, created.option2, created.option3]
      .map((v) => (v ?? '').trim())
      .filter(Boolean)
      .join(' / ')
    if (!label) continue

    const row = rowByLabel.get(label.toLowerCase())
    indexOption(label, notmidVariantId)
    // También por el valor original del proveedor: así la foto de un color se
    // asigna a todas sus variantes.
    if (row) indexOption(row.source.option1, notmidVariantId)

    variantMap.push({
      supplierVariantId: row?.source.supplierVariantId || '',
      option: label,
      notmidVariantId,
      sku: created.sku || row?.source.sku || null,
    })

    // Inventario por variante (qty del proveedor; 0 si OOS)
    try {
      await setVariantInventoryAvailable(notmidVariantId, row?.source.inventoryQuantity ?? 0)
    } catch (err) {
      console.error('[shopify] inventory set failed', label, err)
    }
  }

  const imageResult = await attachAllImages({
    productId,
    imageUrls: input.imageUrls,
    sourceUrl: input.sourceUrl,
    variantFeaturedImageByOption:
      input.variantFeaturedImageByOption ??
      Object.fromEntries(
        Object.entries(input.imageOptionByUrl ?? {}).map(([url, option]) => [option, url]),
      ),
    optionToVariantId,
  })

  const firstVariantId = variantMap[0]?.notmidVariantId
  if (!firstVariantId) throw new Error('Shopify no devolvió variantes')

  return {
    productId,
    variantId: firstVariantId,
    title: product?.title || input.title,
    price: Number(input.price),
    adminUrl: `https://admin.shopify.com/store/${storeHandle}/products/${productId}`,
    imagesAttached: imageResult.attached,
    imageWarnings: imageResult.warnings,
    variantMap,
  }
}
