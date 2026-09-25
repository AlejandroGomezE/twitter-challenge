import { describe, expect, it } from 'vitest'
import { createNavigationDepthStore } from '../navigation-history'

describe('createNavigationDepthStore', () => {
  it('counts pushes, not replaces, and remembers depths across Back/Forward', () => {
    const store = createNavigationDepthStore()
    store.record('default', 'POP') // app opened
    expect(store.canGoBack('default')).toBe(false)

    store.record('r1', 'REPLACE') // e.g. redirect to /sign-in and back
    expect(store.canGoBack('r1')).toBe(false)

    store.record('p1', 'PUSH')
    expect(store.canGoBack('p1')).toBe(true)
    store.record('p1r', 'REPLACE') // canonical redirect keeps the depth
    expect(store.canGoBack('p1r')).toBe(true)

    store.record('r1', 'POP') // browser Back
    expect(store.canGoBack('r1')).toBe(false)
    store.record('p1r', 'POP') // browser Forward
    expect(store.canGoBack('p1r')).toBe(true)
  })

  it('treats unknown entries (e.g. from before a reload) as having nothing behind them', () => {
    const store = createNavigationDepthStore()
    store.record('old', 'POP')
    expect(store.canGoBack('old')).toBe(false)
    expect(store.canGoBack('never-seen')).toBe(false)
  })

  it('ignores a repeated record of the current entry', () => {
    const store = createNavigationDepthStore()
    store.record('default', 'POP')
    store.record('p1', 'PUSH')
    store.record('p1', 'PUSH') // effect re-run: must not count twice
    expect(store.depth('p1')).toBe(1)
    store.record('p2', 'PUSH')
    expect(store.depth('p2')).toBe(2)
    store.record('p2', 'REPLACE') // same key again, whatever the type
    expect(store.depth('p2')).toBe(2)
    store.record('default', 'POP')
    expect(store.depth('default')).toBe(0)
  })
})
