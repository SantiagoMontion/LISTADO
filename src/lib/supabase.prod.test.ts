import { describe, expect, it } from 'vitest'
import { taskProgressRowDone } from './supabase'

describe('taskProgressRowDone', () => {
  it('marca hecho por is_completed', () => {
    expect(taskProgressRowDone({ is_completed: true, current_qty: 0, total_qty: 5 })).toBe(true)
  })

  it('marca hecho cuando current_qty alcanza total', () => {
    expect(taskProgressRowDone({ is_completed: false, current_qty: 5, total_qty: 5 })).toBe(true)
  })

  it('pendiente si falta cantidad', () => {
    expect(taskProgressRowDone({ is_completed: false, current_qty: 3, total_qty: 5 })).toBe(false)
  })
})
