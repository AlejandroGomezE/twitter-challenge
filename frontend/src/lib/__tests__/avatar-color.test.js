import { describe, expect, it } from 'vitest'
import { getAvatarColor, getAvatarInitial } from '../avatar-color'

// Mirrors the (private) palette in avatar-color.js.
const PALETTE = [
  'bg-red-600 text-white',
  'bg-orange-600 text-white',
  'bg-amber-700 text-white',
  'bg-emerald-600 text-white',
  'bg-teal-600 text-white',
  'bg-sky-600 text-white',
  'bg-indigo-600 text-white',
  'bg-fuchsia-600 text-white',
]

const SAMPLE_USERNAMES = ['ada', 'grace', 'linus', 'margaret', 'alan', 'barbara', 'ken', 'dennis', 'x', 'user_123']

describe('getAvatarColor', () => {
  it('is deterministic for the same username', () => {
    expect(getAvatarColor('ada')).toBe(getAvatarColor('ada'))
  })

  it('ignores case', () => {
    expect(getAvatarColor('Ada')).toBe(getAvatarColor('ada'))
    expect(getAvatarColor('ADA_LOVELACE')).toBe(getAvatarColor('ada_lovelace'))
  })

  it('always picks a colour from the palette', () => {
    for (const username of SAMPLE_USERNAMES) {
      expect(PALETTE).toContain(getAvatarColor(username))
    }
  })

  it('spreads different usernames over more than one colour', () => {
    expect(new Set(SAMPLE_USERNAMES.map(getAvatarColor)).size).toBeGreaterThan(1)
  })

  it.each(['', ' ', '🦄', 'ñandú', 'a'.repeat(500)])('does not throw on %j', (value) => {
    expect(PALETTE).toContain(getAvatarColor(value))
  })
})

describe('getAvatarInitial', () => {
  it('returns the first character uppercased', () => {
    expect(getAvatarInitial('ada')).toBe('A')
    expect(getAvatarInitial('Grace')).toBe('G')
  })

  it('keeps a non-letter first character as is', () => {
    expect(getAvatarInitial('_ada')).toBe('_')
    expect(getAvatarInitial('9lives')).toBe('9')
  })

  it('returns an empty string for an empty username', () => {
    expect(getAvatarInitial('')).toBe('')
  })
})
