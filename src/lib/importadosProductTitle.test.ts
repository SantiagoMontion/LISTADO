import { describe, expect, it } from 'vitest'
import { importadosProductTitle } from '../../api/_lib/importados-sync/productTitle'

describe('importadosProductTitle', () => {
  it('removes brackets while preserving their content and appends the suffix', () => {
    expect(importadosProductTitle('Pulsar [T1 Edition] X2 CrazyLight Mini - Black')).toBe(
      'Pulsar T1 Edition X2 CrazyLight Mini - Black | Importados',
    )
  })

  it('does not invent a brand or alter the remaining words', () => {
    expect(importadosProductTitle('[T1 Edition] X2 CrazyLight Mini - Black (OPEN BOX)')).toBe(
      'T1 Edition X2 CrazyLight Mini - Black OPEN BOX | Importados',
    )
  })

  it('supports equivalent bracket characters and avoids duplicate suffixes', () => {
    expect(importadosProductTitle('Mouse 【Limited】 {Black} | importados')).toBe(
      'Mouse Limited Black | Importados',
    )
  })
})
