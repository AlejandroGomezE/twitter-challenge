import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsMobile } from '../use-mobile'

// jsdom has no matchMedia — stub one whose "change" listeners the test can fire.
let listeners: Set<() => void>
function resizeTo(width: number) {
  window.innerWidth = width
  listeners.forEach((listener) => listener())
}

describe('useIsMobile', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    listeners = new Set()
    // Only the listener methods the hook uses.
    window.matchMedia = vi.fn(
      () =>
        ({
          addEventListener: (_: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
        }) as unknown as MediaQueryList,
    )
  })

  afterEach(() => {
    window.innerWidth = originalWidth
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('is true below the 768px breakpoint and false at or above it', () => {
    window.innerWidth = 500
    expect(renderHook(() => useIsMobile()).result.current).toBe(true)

    window.innerWidth = 768
    expect(renderHook(() => useIsMobile()).result.current).toBe(false)
  })

  it('updates when the media query changes', () => {
    window.innerWidth = 1024
    const { result } = renderHook(() => useIsMobile())

    act(() => resizeTo(400))

    expect(result.current).toBe(true)
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useIsMobile())

    unmount()

    expect(listeners.size).toBe(0)
  })
})
