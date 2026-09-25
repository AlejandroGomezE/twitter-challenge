import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiUrl, server } from '@/test/server'
import { normalizeSearchQuery, searchKeys, searchUsers } from '../search'

describe('normalizeSearchQuery', () => {
  it('trims and strips one leading @', () => {
    expect(normalizeSearchQuery('  @Ada  ')).toEqual({ query: 'Ada', searchable: true })
    expect(normalizeSearchQuery('@@ada')).toEqual({ query: '@ada', searchable: true })
    expect(normalizeSearchQuery('ada lovelace')).toEqual({
      query: 'ada lovelace',
      searchable: true,
    })
  })

  it('is not searchable when empty, blank or @-only', () => {
    for (const raw of ['', '   ', '@', '  @  ', undefined, null]) {
      expect(normalizeSearchQuery(raw)).toEqual({ query: '', searchable: false })
    }
  })

  it('caps the query to 50 code points, counting an emoji as one', () => {
    const long = '😀'.repeat(60)
    const { query, searchable } = normalizeSearchQuery(`@${long}`)
    expect(Array.from(query)).toHaveLength(50)
    expect(query).toBe('😀'.repeat(50))
    expect(searchable).toBe(true)
    expect(normalizeSearchQuery('a'.repeat(50)).query).toBe('a'.repeat(50))
  })
})

describe('searchKeys', () => {
  it('shares one entry between equivalent queries, per variant, under the search prefix', () => {
    expect(searchKeys.userResults(' @Ada ', 'typeahead')).toEqual([
      'search',
      'users',
      'typeahead',
      'ada',
    ])
    expect(searchKeys.userResults('ADA', 'typeahead')).toEqual(
      searchKeys.userResults('@ada', 'typeahead'),
    )
    expect(searchKeys.userResults('ada', 'all')).not.toEqual(
      searchKeys.userResults('ada', 'typeahead'),
    )
    expect(searchKeys.userResults('ada', 'all').slice(0, 1)).toEqual(searchKeys.all)
  })

  it('folds only ASCII case, like the server’s SQLite LIKE', () => {
    expect(searchKeys.userResults('Ada', 'all')).toEqual(searchKeys.userResults('ada', 'all'))
    expect(searchKeys.userResults('É', 'all')).not.toEqual(searchKeys.userResults('é', 'all'))
    expect(searchKeys.userResults('ÉmiLE', 'all')[3]).toBe('Émile')
  })
})

describe('searchUsers', () => {
  const capture = () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get(apiUrl('/search/users'), ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json({ items: [], nextCursor: null })
      }),
    )
    return seen
  }

  it('sends the normalized query and the limit, without a cursor on the first page', async () => {
    const seen = capture()
    await expect(searchUsers(' @Ada L', { limit: 5 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    })
    expect(seen[0].get('q')).toBe('Ada L')
    expect(seen[0].get('limit')).toBe('5')
    expect(seen[0].has('cursor')).toBe(false)
  })

  it('sends the cursor when there is one, and omits an unset limit', async () => {
    const seen = capture()
    await searchUsers('ada', { cursor: 'c1' })
    expect(seen[0].get('cursor')).toBe('c1')
    expect(seen[0].has('limit')).toBe(false)
  })
})
