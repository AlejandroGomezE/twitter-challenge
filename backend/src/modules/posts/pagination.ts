import { BadRequestException } from '@nestjs/common';

// Keyset pagination over (createdAt, id). The cursor is opaque to clients:
// base64url-encoded JSON `[createdAt ISO-8601, id]` of the last item of a
// page. Ordering by both columns means posts with equal timestamps are never
// skipped or duplicated across pages. Used by every paged listing: the feed,
// a user's posts and a post's comments.

export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export const INVALID_CURSOR_MESSAGE = 'Invalid cursor';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface CursorPosition {
  createdAt: Date;
  id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(
    JSON.stringify([position.createdAt.toISOString(), position.id]),
    'utf8',
  ).toString('base64url');
}

// Throws a 400 `Invalid cursor` for anything encodeCursor could not have
// produced.
export function decodeCursor(cursor: string): CursorPosition {
  if (!BASE64URL_PATTERN.test(cursor)) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    parsed[1] === ''
  ) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  const [iso, id] = parsed as [string, string];
  const createdAt = new Date(iso);
  // Only canonical ISO strings (what encodeCursor writes) are accepted.
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  return { createdAt, id };
}

// Page size for a request: PAGE_SIZE when omitted. The range (1..MAX_PAGE_SIZE,
// integer) is enforced once, by ListPostsQueryDto (400 otherwise).
export function resolvePageSize(requested?: number): number {
  return requested ?? PAGE_SIZE;
}
