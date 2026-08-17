import { describe, expect, it } from 'vitest'
import {
  looksMostlySpanish,
  sanitizePublicProductHtml,
} from '../../api/_lib/importados-sync/productDescription'

describe('sanitizePublicProductHtml', () => {
  it('keeps specs and drops MK US-duty + FAQ + store promo', () => {
    const html = `
<ul>
  <li>PixArt 3950</li>
  <li>Todos los aranceles de importación de EE. UU. son pagados por adelantado por MK y ya están incluidos en el precio. Para obtener más información, consulta nuestras preguntas frecuentes.</li>
</ul>
<h4>¡Este artículo viene con una tecla GMK Frozen Llama!</h4>
Obtenga una tecla promocional con cualquier compra en mechanicalkeyboards.com.
<p>Dongle 8K incluido</p>
`
    const out = sanitizePublicProductHtml(html)
    expect(out).toMatch(/PixArt 3950/)
    expect(out).toMatch(/Dongle 8K/)
    expect(out).not.toMatch(/EE\. UU/)
    expect(out).not.toMatch(/preguntas frecuentes/)
    expect(out).not.toMatch(/mechanicalkeyboards/)
    expect(out).not.toMatch(/Frozen Llama/)
  })

  it('keeps the rest of a long block that also has the duty sentence', () => {
    const html = `<p>PixArt 3950. Todos los aranceles de importación de EE. UU. son pagados por adelantado por MK y ya están incluidos en el precio. Para obtener más información, consulta nuestras preguntas frecuentes. Dongle 8K incluido.</p>`
    const out = sanitizePublicProductHtml(html)
    expect(out).toMatch(/PixArt 3950/)
    expect(out).toMatch(/Dongle 8K/)
    expect(out).not.toMatch(/aranceles/)
    expect(out).not.toMatch(/preguntas frecuentes/)
  })

  it('unwraps supplier links so they are not clickable', () => {
    const out = sanitizePublicProductHtml(
      `<p>Ver <a href="https://lethal.gg/products/x">más</a> details</p>`,
    )
    expect(out).not.toMatch(/href=/)
    expect(out).toMatch(/más/)
  })
})

describe('looksMostlySpanish', () => {
  it('does not skip English Lethal-style copy', () => {
    expect(
      looksMostlySpanish(
        'Lightweight gaming mouse with optical switch and USB-C cable. The sensor tracks at 8000 Hz. Designed for performance.',
      ),
    ).toBe(false)
  })

  it('detects a Spanish description', () => {
    expect(
      looksMostlySpanish(
        'Este teclado inalámbrico incluye características pensadas para jugar. Los interruptores están diseñados para una respuesta precisa. También tiene garantía.',
      ),
    ).toBe(true)
  })
})
