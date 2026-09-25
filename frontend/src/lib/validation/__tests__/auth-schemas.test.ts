import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, signUpSchema } from '../auth-schemas'

const valid = {
  displayName: 'Ada Lovelace',
  username: 'ada',
  email: 'ada@example.com',
  password: 'a'.repeat(PASSWORD_MIN_LENGTH),
  confirmPassword: 'a'.repeat(PASSWORD_MIN_LENGTH),
}

const parse = (overrides?: Record<string, unknown>) => signUpSchema.safeParse({ ...valid, ...overrides })

// The issue messages on one field, e.g. `messagesAt(result, 'displayName')`.
const messagesAt = (result: z.ZodSafeParseResult<unknown>, field: string) =>
  (result.error?.issues ?? []).filter((issue) => issue.path[0] === field).map((issue) => issue.message)

describe('signUpSchema', () => {
  it('accepts a complete sign-up', () => {
    expect(parse().success).toBe(true)
  })

  describe('displayName', () => {
    it('is required when missing', () => {
      const result = parse({ displayName: undefined })

      expect(result.success).toBe(false)
      expect(messagesAt(result, 'displayName')).not.toHaveLength(0)
    })

    it.each(['', '   ', '\t '])('is required when blank (%j)', (displayName) => {
      const result = parse({ displayName })

      expect(result.success).toBe(false)
      expect(messagesAt(result, 'displayName')).toEqual(['Name is required'])
    })

    it('is trimmed', () => {
      expect(signUpSchema.parse({ ...valid, displayName: '  Ada Lovelace ' }).displayName).toBe(
        'Ada Lovelace',
      )
    })

    it('accepts 50 code points (emoji count as 1) and rejects 51', () => {
      expect(parse({ displayName: '😀'.repeat(50) }).success).toBe(true)

      const result = parse({ displayName: '😀'.repeat(51) })
      expect(result.success).toBe(false)
      expect(messagesAt(result, 'displayName')).toEqual(['Name must be at most 50 characters'])
    })

    it.each(['Ada\nLovelace', 'Ada\r\nLovelace'])('rejects a line break inside (%j)', (displayName) => {
      const result = parse({ displayName })

      expect(result.success).toBe(false)
      expect(messagesAt(result, 'displayName')).toEqual(["Name can't contain line breaks"])
    })
  })

  describe('the other fields', () => {
    it('normalizes the username and rejects an invalid one', () => {
      expect(signUpSchema.parse({ ...valid, username: ' Ada_99 ' }).username).toBe('ada_99')
      expect(messagesAt(parse({ username: 'ab' }), 'username')).toContain(
        'Username must be at least 3 characters',
      )
    })

    it('trims the email and rejects an invalid or empty one', () => {
      expect(signUpSchema.parse({ ...valid, email: ' ada@example.com ' }).email).toBe(
        'ada@example.com',
      )
      expect(messagesAt(parse({ email: 'not-an-email' }), 'email')).toEqual([
        'Enter a valid email address',
      ])
      expect(messagesAt(parse({ email: '' }), 'email')).toEqual(['Email is required'])
    })

    it('enforces the password length bounds', () => {
      const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1)
      const max = 'a'.repeat(PASSWORD_MAX_LENGTH)
      const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1)

      expect(parse({ password: max, confirmPassword: max }).success).toBe(true)
      expect(messagesAt(parse({ password: short, confirmPassword: short }), 'password')).toEqual([
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      ])
      expect(messagesAt(parse({ password: long, confirmPassword: long }), 'password')).toEqual([
        `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
      ])
    })

    it('requires the confirmation to match the password', () => {
      expect(messagesAt(parse({ confirmPassword: '' }), 'confirmPassword')).toContain(
        'Confirm your password',
      )
      expect(
        messagesAt(parse({ confirmPassword: 'b'.repeat(PASSWORD_MIN_LENGTH) }), 'confirmPassword'),
      ).toEqual(["Passwords don't match"])
    })
  })
})
