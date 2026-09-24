import { describe, expect, it } from 'vitest'
import { bioSchema, RESERVED_USERNAMES, usernameSchema } from '../profile-schemas'

const messagesOf = (result) => result.error.issues.map((issue) => issue.message)

describe('usernameSchema', () => {
  it('trims and lowercases before validating', () => {
    expect(usernameSchema.parse('  Ada_Lovelace ')).toBe('ada_lovelace')
  })

  it('accepts letters, numbers and underscores', () => {
    expect(usernameSchema.parse('ada_99')).toBe('ada_99')
  })

  it.each([
    ['abc', true],
    ['ab', false],
    ['a'.repeat(20), true],
    ['a'.repeat(21), false],
  ])('length boundary: %s → valid %s', (value, valid) => {
    expect(usernameSchema.safeParse(value).success).toBe(valid)
  })

  it('measures length after trimming', () => {
    const result = usernameSchema.safeParse('  ab  ')

    expect(result.success).toBe(false)
    expect(messagesOf(result)).toContain('Username must be at least 3 characters')
  })

  it('reports the too-long message', () => {
    expect(messagesOf(usernameSchema.safeParse('a'.repeat(21)))).toContain(
      'Username must be at most 20 characters',
    )
  })

  it.each(['ada lovelace', 'ada-lovelace', 'adá_l', 'ada.l', 'ada!'])(
    'rejects %j (outside a-z, 0-9, _)',
    (value) => {
      const result = usernameSchema.safeParse(value)

      expect(result.success).toBe(false)
      expect(messagesOf(result)).toContain('Only letters, numbers and underscores')
    },
  )

  it.each(RESERVED_USERNAMES.flatMap((word) => [word, word.toUpperCase(), ` ${word} `]))(
    'rejects the reserved word %j',
    (value) => {
      expect(usernameSchema.safeParse(value).success).toBe(false)
    },
  )

  // Reserved words that pass every other rule fail specifically on the reserved check.
  it.each(['settings', 'AUTH', 'Users', 'api', 'Admin', 'root'])(
    'reports %j as not available',
    (value) => {
      expect(messagesOf(usernameSchema.safeParse(value))).toEqual(["This username isn't available"])
    },
  )

  // Guard: this list MUST stay identical to the authoritative backend copy in
  // `backend/src/modules/users/username.rules.ts` (RESERVED_USERNAMES). Update both together.
  it('keeps the reserved list in sync with the backend', () => {
    expect(RESERVED_USERNAMES).toEqual([
      'me',
      'settings',
      'sign-in',
      'sign-up',
      'sign-out',
      'auth',
      'users',
      'u',
      'api',
      'admin',
      'root',
    ])
  })
})

describe('bioSchema', () => {
  it('trims', () => {
    expect(bioSchema.parse('  Hello there \n')).toBe('Hello there')
  })

  it('accepts an empty string (clears the bio)', () => {
    expect(bioSchema.parse('')).toBe('')
    expect(bioSchema.parse('   ')).toBe('')
  })

  it('accepts exactly 160 characters', () => {
    expect(bioSchema.safeParse('a'.repeat(160)).success).toBe(true)
  })

  it('rejects 161 characters', () => {
    const result = bioSchema.safeParse('a'.repeat(161))

    expect(result.success).toBe(false)
    expect(messagesOf(result)).toContain('Bio must be 160 characters or fewer')
  })

  it('measures length after trimming', () => {
    expect(bioSchema.safeParse(`  ${'a'.repeat(160)}  `).success).toBe(true)
  })
})
