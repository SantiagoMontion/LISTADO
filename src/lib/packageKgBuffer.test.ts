import { describe, expect, it } from 'vitest'
import {
  bufferedPackageKg,
  packageKgBufferGrams,
} from '../../api/_lib/importados-sync/packageKgBuffer'

describe('bufferedPackageKg', () => {
  it('adds 100 g under 1 kg', () => {
    expect(packageKgBufferGrams(0.4)).toBe(100)
    expect(bufferedPackageKg(0.4)).toBe(0.5)
    expect(bufferedPackageKg(0.35)).toBe(0.45)
  })

  it('adds 150 g from 1 kg up to 2.5 kg', () => {
    expect(packageKgBufferGrams(1)).toBe(150)
    expect(bufferedPackageKg(1.35)).toBe(1.5)
    expect(bufferedPackageKg(1.85)).toBe(2)
    expect(bufferedPackageKg(2.3)).toBe(2.45)
  })

  it('adds 200 g from 2.5 kg', () => {
    expect(packageKgBufferGrams(2.5)).toBe(200)
    expect(bufferedPackageKg(2.5)).toBe(2.7)
    expect(bufferedPackageKg(2.8)).toBe(3)
    expect(bufferedPackageKg(5.16)).toBe(5.36)
  })
})
