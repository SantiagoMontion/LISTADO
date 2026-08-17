import { describe, expect, it } from 'vitest'
import { parseCalcNumber } from '../components/CalcNumberField'

describe('parseCalcNumber', () => {
  it('acepta punto y coma como decimal', () => {
    expect(parseCalcNumber('0.5')).toBe(0.5)
    expect(parseCalcNumber('0,5')).toBe(0.5)
    expect(parseCalcNumber('1,25')).toBe(1.25)
  })

  it('usa el último separador como decimal', () => {
    expect(parseCalcNumber('1.234,5')).toBe(1234.5)
    expect(parseCalcNumber('1,234.5')).toBe(1234.5)
  })

  it('rechaza vacío', () => {
    expect(parseCalcNumber('')).toBeNull()
    expect(parseCalcNumber(',')).toBeNull()
  })
})
