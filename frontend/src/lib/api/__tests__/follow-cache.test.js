import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { searchKeys } from '@/lib/api/search'
import { followKeys, profileQueryKey } from '@/lib/api/users'
import {
  bumpProfileFollowingCount,
  findFollowState,
  followQueryFilters,
  setFollowInProfile,
  setFollowingInLists,
} from '../follow-cache'

const newClient = () => createQueryClient({ queries: { retry: false, gcTime: Infinity } })

const row = (username, isFollowing) => ({ username, bio: null, isFollowing })
const infinite = (...pages) => ({
  pages: pages.map((items, i) => ({ items, nextCursor: i < pages.length - 1 ? `c${i}` : null })),
  pageParams: pages.map((_, i) => (i === 0 ? null : `c${i - 1}`)),
})
const profile = (overrides = {}) => ({
  username: 'ada',
  isFollowing: false,
  followerCount: 3,
  followingCount: 5,
  ...overrides,
})

describe('followQueryFilters', () => {
  it("covers the target's profile, the caller's profile, every follow listing and search", () => {
    expect(followQueryFilters('Ada', 'Bob')).toEqual([
      { queryKey: ['users', 'ada', 'profile'], exact: true },
      { queryKey: ['users', 'bob', 'profile'], exact: true },
      { queryKey: ['follows'] },
      { queryKey: ['search'] },
    ])
  })

  it("omits the caller's profile when the caller is unknown", () => {
    expect(followQueryFilters('ada', null)).toEqual([
      { queryKey: ['users', 'ada', 'profile'], exact: true },
      { queryKey: ['follows'] },
      { queryKey: ['search'] },
    ])
  })
})

describe('findFollowState', () => {
  it('reads the follow state and followerCount from a cached profile', () => {
    const queryClient = newClient()
    queryClient.setQueryData(profileQueryKey('ada'), profile({ isFollowing: true, followerCount: 7 }))
    queryClient.setQueryData(followKeys.suggestions(), { items: [row('ada', false)] })

    expect(findFollowState(queryClient, 'ADA')).toEqual({ following: true, followerCount: 7 })
  })

  it('reports a null followerCount when the profile has none', () => {
    const queryClient = newClient()
    queryClient.setQueryData(profileQueryKey('ada'), { username: 'ada', isFollowing: false })

    expect(findFollowState(queryClient, 'ada')).toEqual({ following: false, followerCount: null })
  })

  it('falls back to a listed row, matching the username case-insensitively', () => {
    const queryClient = newClient()
    queryClient.setQueryData(
      followKeys.followers('bob'),
      infinite([row('carol', false)], [row('Ada', true)]),
    )

    expect(findFollowState(queryClient, 'ada')).toEqual({ following: true, followerCount: null })
  })

  it('falls back to a suggestions row', () => {
    const queryClient = newClient()
    queryClient.setQueryData(followKeys.suggestions(), { items: [row('ada', false)] })

    expect(findFollowState(queryClient, 'Ada')).toEqual({ following: false, followerCount: null })
  })

  it('falls back to a search result row (typeahead page or Explore pages)', () => {
    const queryClient = newClient()
    queryClient.setQueryData(searchKeys.userResults('ad', 'typeahead'), {
      items: [row('Ada', true)],
      nextCursor: null,
    })
    expect(findFollowState(queryClient, 'ada')).toEqual({ following: true, followerCount: null })

    const other = newClient()
    other.setQueryData(
      searchKeys.userResults('a', 'all'),
      infinite([row('bob', false)], [row('ada', false)]),
    )
    expect(findFollowState(other, 'ada')).toEqual({ following: false, followerCount: null })
  })

  it('returns null when the user is not cached anywhere', () => {
    const queryClient = newClient()
    queryClient.setQueryData(followKeys.suggestions(), { items: [row('carol', true)] })
    queryClient.setQueryData(followKeys.following('bob'), infinite([row('dave', true)]))

    expect(findFollowState(queryClient, 'ada')).toBeNull()
  })
})

describe('setFollowInProfile', () => {
  it('flips isFollowing and bumps followerCount by one on follow (case-insensitive key)', () => {
    const queryClient = newClient()
    queryClient.setQueryData(profileQueryKey('ada'), profile())

    setFollowInProfile(queryClient, 'Ada', true)

    expect(queryClient.getQueryData(profileQueryKey('ada'))).toMatchObject({
      isFollowing: true,
      followerCount: 4,
    })
  })

  it('drops followerCount by one on unfollow, never below 0', () => {
    const queryClient = newClient()
    queryClient.setQueryData(profileQueryKey('ada'), profile({ isFollowing: true, followerCount: 0 }))

    setFollowInProfile(queryClient, 'ada', false)

    expect(queryClient.getQueryData(profileQueryKey('ada'))).toMatchObject({
      isFollowing: false,
      followerCount: 0,
    })
  })

  it('uses an explicit server followerCount instead of adjusting', () => {
    const queryClient = newClient()
    queryClient.setQueryData(profileQueryKey('ada'), profile())

    setFollowInProfile(queryClient, 'ada', true, 42)

    expect(queryClient.getQueryData(profileQueryKey('ada'))).toMatchObject({
      isFollowing: true,
      followerCount: 42,
    })
  })

  it('does not adjust the count when the state does not flip', () => {
    const queryClient = newClient()
    const before = profile({ isFollowing: true })
    queryClient.setQueryData(profileQueryKey('ada'), before)

    setFollowInProfile(queryClient, 'ada', true)

    expect(queryClient.getQueryData(profileQueryKey('ada'))).toBe(before)
  })

  it('leaves an uncached profile uncached and other profiles untouched', () => {
    const queryClient = newClient()
    const other = profile({ username: 'bob' })
    queryClient.setQueryData(profileQueryKey('bob'), other)

    setFollowInProfile(queryClient, 'ada', true)

    expect(queryClient.getQueryData(profileQueryKey('ada'))).toBeUndefined()
    expect(queryClient.getQueryData(profileQueryKey('bob'))).toBe(other)
  })
})

describe('setFollowingInLists', () => {
  it("updates only the target's rows across followers, following and suggestions", () => {
    const queryClient = newClient()
    queryClient.setQueryData(
      followKeys.followers('bob'),
      infinite([row('carol', false), row('Ada', false)], [row('dave', false)]),
    )
    queryClient.setQueryData(followKeys.following('carol'), infinite([row('ada', false)]))
    queryClient.setQueryData(followKeys.suggestions(), {
      items: [row('eve', false), row('ADA', false)],
    })

    setFollowingInLists(queryClient, 'ada', true)

    const followers = queryClient.getQueryData(followKeys.followers('bob'))
    expect(followers.pages[0].items).toEqual([row('carol', false), row('Ada', true)])
    expect(followers.pages[1].items).toEqual([row('dave', false)])
    expect(queryClient.getQueryData(followKeys.following('carol')).pages[0].items).toEqual([
      row('ada', true),
    ])
    expect(queryClient.getQueryData(followKeys.suggestions()).items).toEqual([
      row('eve', false),
      row('ADA', true),
    ])
  })

  it('keeps pages and lists without the target (or already in that state) by reference', () => {
    const queryClient = newClient()
    const unrelated = infinite([row('carol', false)])
    const alreadySet = infinite([row('ada', true)])
    const suggestions = { items: [row('eve', false)] }
    const mixed = infinite([row('dave', true)], [row('ada', false)])
    queryClient.setQueryData(followKeys.followers('bob'), unrelated)
    queryClient.setQueryData(followKeys.following('bob'), alreadySet)
    queryClient.setQueryData(followKeys.suggestions(), suggestions)
    queryClient.setQueryData(followKeys.followers('zed'), mixed)

    setFollowingInLists(queryClient, 'ada', true)

    expect(queryClient.getQueryData(followKeys.followers('bob'))).toBe(unrelated)
    expect(queryClient.getQueryData(followKeys.following('bob'))).toBe(alreadySet)
    expect(queryClient.getQueryData(followKeys.suggestions())).toBe(suggestions)
    const updated = queryClient.getQueryData(followKeys.followers('zed'))
    expect(updated).not.toBe(mixed)
    expect(updated.pages[0]).toBe(mixed.pages[0])
    expect(updated.pages[1].items).toEqual([row('ada', true)])
  })

  it("updates the target's search result rows, in both the typeahead and Explore shapes", () => {
    const queryClient = newClient()
    const unrelated = { items: [row('carol', false)], nextCursor: null }
    queryClient.setQueryData(searchKeys.userResults('a', 'typeahead'), {
      items: [row('ADA', false), row('bob', false)],
      nextCursor: 'c0',
    })
    queryClient.setQueryData(
      searchKeys.userResults('a', 'all'),
      infinite([row('bob', false)], [row('ada', false)]),
    )
    queryClient.setQueryData(searchKeys.userResults('car', 'typeahead'), unrelated)

    setFollowingInLists(queryClient, 'ada', true)

    expect(queryClient.getQueryData(searchKeys.userResults('a', 'typeahead'))).toEqual({
      items: [row('ADA', true), row('bob', false)],
      nextCursor: 'c0',
    })
    const explore = queryClient.getQueryData(searchKeys.userResults('a', 'all'))
    expect(explore.pages[0].items).toEqual([row('bob', false)])
    expect(explore.pages[1].items).toEqual([row('ada', true)])
    expect(queryClient.getQueryData(searchKeys.userResults('car', 'typeahead'))).toBe(unrelated)
  })

  it('leaves profiles and unloaded suggestions alone', () => {
    const queryClient = newClient()
    const adaProfile = profile()
    queryClient.setQueryData(profileQueryKey('ada'), adaProfile)

    setFollowingInLists(queryClient, 'ada', true)

    expect(queryClient.getQueryData(profileQueryKey('ada'))).toBe(adaProfile)
    expect(queryClient.getQueryData(followKeys.suggestions())).toBeUndefined()
  })
})

describe('bumpProfileFollowingCount', () => {
  it("adds the delta to a cached profile's followingCount (case-insensitive key)", () => {
    const queryClient = newClient()
    queryClient.setQueryData(profileQueryKey('bob'), profile({ username: 'bob', followingCount: 2 }))

    bumpProfileFollowingCount(queryClient, 'Bob', 1)
    expect(queryClient.getQueryData(profileQueryKey('bob')).followingCount).toBe(3)

    bumpProfileFollowingCount(queryClient, 'bob', -1)
    expect(queryClient.getQueryData(profileQueryKey('bob')).followingCount).toBe(2)
  })

  it('never goes below 0', () => {
    const queryClient = newClient()
    queryClient.setQueryData(profileQueryKey('bob'), profile({ username: 'bob', followingCount: 0 }))

    bumpProfileFollowingCount(queryClient, 'bob', -1)

    expect(queryClient.getQueryData(profileQueryKey('bob')).followingCount).toBe(0)
  })

  it('does nothing for an uncached profile or one without a followingCount', () => {
    const queryClient = newClient()
    const noCount = { username: 'carol', isFollowing: false }
    const other = profile()
    queryClient.setQueryData(profileQueryKey('carol'), noCount)
    queryClient.setQueryData(profileQueryKey('ada'), other)

    bumpProfileFollowingCount(queryClient, 'bob', 1)
    bumpProfileFollowingCount(queryClient, 'carol', 1)

    expect(queryClient.getQueryData(profileQueryKey('bob'))).toBeUndefined()
    expect(queryClient.getQueryData(profileQueryKey('carol'))).toBe(noCount)
    expect(queryClient.getQueryData(profileQueryKey('ada'))).toBe(other)
  })
})
