import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from '../use-debounced-value'

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts with the initial value', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 250))
    expect(result.current).toBe('a')
  })

  it('updates once, with the last value, after it stops changing for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: '' },
    })

    rerender({ value: 'a' })
    act(() => vi.advanceTimersByTime(200))
    rerender({ value: 'ad' })
    act(() => vi.advanceTimersByTime(200))
    rerender({ value: 'ada' })
    act(() => vi.advanceTimersByTime(249))
    // Each change restarted the timer, so nothing has come through yet.
    expect(result.current).toBe('')

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('ada')
  })
})
