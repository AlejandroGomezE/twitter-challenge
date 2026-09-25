import { describe, expect, it } from 'vitest'
import { ApiError } from '../client'
import { getApiErrorMessage } from '../error-message'

const FALLBACK = 'Something went wrong. Please try again.'

describe('getApiErrorMessage', () => {
  it('uses a fixed message for 429', () => {
    const error = new ApiError(429, 'ThrottlerException: Too Many Requests', {
      message: 'ThrottlerException: Too Many Requests',
    })

    expect(getApiErrorMessage(error)).toBe('Too many attempts. Try again in a minute.')
  })

  it('uses the caller\'s rateLimitMessage for 429 when given', () => {
    const error = new ApiError(429, 'ThrottlerException: Too Many Requests', null)

    expect(getApiErrorMessage(error, { rateLimitMessage: 'Too many posts.' })).toBe('Too many posts.')
  })

  it("joins a validation error's message array with '. '", () => {
    const messages = ['username must be a string', 'bio must be shorter']
    const error = new ApiError(400, messages.join(','), { message: messages })

    expect(getApiErrorMessage(error)).toBe('username must be a string. bio must be shorter')
  })

  it('uses a string message as is', () => {
    const error = new ApiError(409, 'Username is already taken', {
      message: 'Username is already taken',
    })

    expect(getApiErrorMessage(error)).toBe('Username is already taken')
  })

  it('falls back when the ApiError has no message', () => {
    expect(getApiErrorMessage(new ApiError(500, '', null))).toBe(FALLBACK)
  })

  it.each([
    ['a plain Error', new Error('boom')],
    ['a TypeError (network failure)', new TypeError('Failed to fetch')],
    ['undefined', undefined],
    ['a string', 'oops'],
  ])('falls back for %s', (_label, error) => {
    expect(getApiErrorMessage(error)).toBe(FALLBACK)
  })
})
