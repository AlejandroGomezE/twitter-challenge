import { describe, expect, it } from 'vitest'
import { getRedirectTarget } from '../redirect-target'

describe('getRedirectTarget', () => {
  it('keeps an in-app path and its search', () => {
    expect(getRedirectTarget({ pathname: '/some/page', search: '?x=1' })).toBe('/some/page?x=1')
  })

  it('keeps an in-app path without a search', () => {
    expect(getRedirectTarget({ pathname: '/some/page' })).toBe('/some/page')
  })

  it.each([
    ['a protocol-relative path', { pathname: '//evil.com' }],
    ['a backslash protocol-relative path', { pathname: '/\\evil.com' }],
    ['an absolute URL', { pathname: 'https://evil.com' }],
    ['a relative path', { pathname: 'some/page' }],
    ['a non-string pathname', { pathname: 42 }],
    ['a missing pathname', {}],
    ['a missing `from`', undefined],
    ['a null `from`', null],
  ])('falls back to / for %s', (_, from) => {
    expect(getRedirectTarget(from)).toBe('/')
  })
})
