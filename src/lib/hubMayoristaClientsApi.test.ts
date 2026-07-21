import { describe, expect, it } from 'vitest'
import {
  appendClientToTaskBody,
  normalizeMayoristaPhone,
  normalizeMayoristaClientName,
} from './hubMayoristaClientsApi'

describe('normalizeMayoristaPhone', () => {
  it('quita guiones y espacios', () => {
    expect(normalizeMayoristaPhone('11-2345-6789')).toBe('1123456789')
  })

  it('quita prefijo 549', () => {
    expect(normalizeMayoristaPhone('5491123456789')).toBe('1123456789')
  })

  it('quita prefijo 54', () => {
    expect(normalizeMayoristaPhone('541123456789')).toBe('1123456789')
  })
})

describe('normalizeMayoristaClientName', () => {
  it('recorta y colapsa espacios', () => {
    expect(normalizeMayoristaClientName('  Juan   Pérez  ')).toBe('Juan Pérez')
  })
})

describe('appendClientToTaskBody', () => {
  it('agrega bloque de cliente al detalle', () => {
    const out = appendClientToTaskBody('Pedido urgente', {
      full_name: 'Juan Pérez',
      dni: '12345678',
      phone: '1123456789',
      email: 'juan@test.com',
      address: 'Calle 123',
    })
    expect(out).toContain('Pedido urgente')
    expect(out).toContain('Cliente: Juan Pérez')
    expect(out).toContain('DNI: 12345678')
  })
})
