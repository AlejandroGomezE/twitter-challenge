import { describe, expect, it } from 'vitest'
import {
  isSubmitShortcut,
  limitAnnouncement,
  measureBody,
  type SubmitShortcutEvent,
} from '../text'

describe('measureBody', () => {
  it('trims and counts code points', () => {
    expect(measureBody('  hi \u{1F600} ')).toEqual({
      trimmed: 'hi \u{1F600}',
      length: 4,
      remaining: 276,
      isOver: false,
      isValid: true,
    })
  })

  it('is invalid when blank or over 280', () => {
    expect(measureBody('   ').isValid).toBe(false)
    expect(measureBody('a'.repeat(281))).toMatchObject({ isOver: true, isValid: false, remaining: -1 })
    expect(measureBody('a'.repeat(280)).isValid).toBe(true)
  })
})

describe('limitAnnouncement', () => {
  it('is silent until 20 left, then counts down, then counts the overflow', () => {
    expect(limitAnnouncement(21)).toBe('')
    expect(limitAnnouncement(20)).toBe('20 characters left')
    expect(limitAnnouncement(1)).toBe('1 character left')
    expect(limitAnnouncement(-1)).toBe('1 character over the limit')
    expect(limitAnnouncement(-3)).toBe('3 characters over the limit')
  })
})

describe('isSubmitShortcut', () => {
  const key = (overrides: Partial<SubmitShortcutEvent>): SubmitShortcutEvent => ({ key: 'Enter', nativeEvent: {}, ...overrides })

  it('matches Cmd/Ctrl+Enter only', () => {
    expect(isSubmitShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isSubmitShortcut(key({ metaKey: true }))).toBe(true)
    expect(isSubmitShortcut(key({}))).toBe(false)
    expect(isSubmitShortcut(key({ key: 'a', ctrlKey: true }))).toBe(false)
  })

  it('ignores Enter while an IME is composing', () => {
    expect(isSubmitShortcut(key({ ctrlKey: true, nativeEvent: { isComposing: true } }))).toBe(false)
    expect(isSubmitShortcut(key({ ctrlKey: true, keyCode: 229 }))).toBe(false)
  })
})
