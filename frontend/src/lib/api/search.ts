import { apiClient } from '@/lib/api/client';
import type { FollowUser, Page } from '@/lib/api/types';

// Longest search query the server accepts, in code points (after trimming and stripping `@`).
export const SEARCH_QUERY_MAX_LENGTH = 50;

// Normalizes a raw search input the way the server does: trimmed, one leading `@` stripped (so
// `@ada` finds ada), then capped to `SEARCH_QUERY_MAX_LENGTH` code points (a longer paste searches
// its first 50 instead of being a 400). `searchable` is false when nothing is left to search
// (empty, blank or `@`-only input). Case is kept; the server matches case-insensitively.
export function normalizeSearchQuery(raw: unknown) {
  let query = typeof raw === 'string' ? raw.trim() : '';
  if (query.startsWith('@')) query = query.slice(1);
  const codePoints = Array.from(query);
  if (codePoints.length > SEARCH_QUERY_MAX_LENGTH) {
    query = codePoints.slice(0, SEARCH_QUERY_MAX_LENGTH).join('');
  }
  return { query, searchable: query.length > 0 };
}

// Query-key factory for search results. Everything lives under `['search']` so the follow cache
// helpers (follow-cache.js) can reach every result row with one prefix. `variant` separates the
// data shapes cached for the same query: `'typeahead'` (one small page, `{ items, nextCursor }`)
// and `'all'` (the Explore infinite query, `{ pages, pageParams }`). The query is normalized and
// ASCII-lowercased, so `@Ada`, ` ada ` and `ADA` share an entry. Only A–Z are folded: the server
// matches with SQLite `LIKE`, which folds ASCII case only, so `É` and `é` are different searches
// with different results and must not share a cache entry.
const foldAsciiCase = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

export const searchKeys = {
  all: ['search'] as const,
  users: () => ['search', 'users'] as const,
  userResults: (q: string, variant: 'typeahead' | 'all') =>
    [
    'search',
    'users',
    variant,
    foldAsciiCase(normalizeSearchQuery(q).query),
  ] as const,
};

// `GET /search/users?q=&cursor=&limit=` → `{ items: FollowUser[], nextCursor }`: users whose
// username or display name contains `q`, ordered by username. `FollowUser` = `{ username,
// displayName, bio, isFollowing, followsYou }`. `q` is sent normalized (see above); `cursor` is only
// sent when there is one (an empty cursor is a 400); `limit` 1–50 (server default 20). Rejects with
// an ApiError (400 for an empty / too long query or a bad cursor / limit).
export function searchUsers(
  q: string,
  { cursor, limit }: { cursor?: string | null; limit?: number | null } = {},
) {
  const params = new URLSearchParams({ q: normalizeSearchQuery(q).query });
  if (cursor) params.set('cursor', cursor);
  if (limit !== undefined && limit !== null) params.set('limit', String(limit));
  return apiClient.get<Page<FollowUser>>(`/search/users?${params}`);
}
