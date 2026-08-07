const IMPORTADOS_SUFFIX = ' | Importados'

/**
 * Conserva el título del proveedor y solo elimina signos de agrupación que no
 * aportan al SEO. No agrega marcas ni modifica las palabras originales.
 */
export function importadosProductTitle(sourceTitle: string): string {
  const withoutExistingSuffix = sourceTitle
    .trim()
    .replace(/\s*\|\s*importados\s*$/i, '')

  const cleaned = withoutExistingSuffix
    .replace(/[\[\]［］【】{}（）()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return `${cleaned}${IMPORTADOS_SUFFIX}`
}
