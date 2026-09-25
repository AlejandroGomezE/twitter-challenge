import { BadRequestException } from '@nestjs/common';
import { INVALID_CURSOR_MESSAGE } from '../posts/pagination.js';

// Keyset cursor over `username` (unique), for listings ordered by username
// (GET /search/users). Same conventions as posts/pagination.ts: opaque to
// clients, base64url-encoded JSON — here `[username]` of the last item of a
// page — and a 400 `Invalid cursor` for anything encodeUsernameCursor could
// not have produced.

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function encodeUsernameCursor(username: string): string {
  return Buffer.from(JSON.stringify([username]), 'utf8').toString('base64url');
}

export function decodeUsernameCursor(cursor: string): string {
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
    parsed.length !== 1 ||
    typeof parsed[0] !== 'string' ||
    parsed[0] === ''
  ) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  return parsed[0];
}
