import { BadRequestException } from '@nestjs/common';
import {
  decodeUsernameCursor,
  encodeUsernameCursor,
} from '../username-cursor.js';

describe('username cursor', () => {
  it('round-trips a username through an opaque base64url string', () => {
    const cursor = encodeUsernameCursor('ada_lovelace');

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain('ada_lovelace');
    expect(decodeUsernameCursor(cursor)).toBe('ada_lovelace');
  });

  function encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }

  it.each([
    ['empty', ''],
    ['not base64url', 'abc+/='],
    ['not JSON', Buffer.from('nope', 'utf8').toString('base64url')],
    ['a bare string', encodeJson('ada')],
    ['an empty array', encodeJson([])],
    ['an empty username', encodeJson([''])],
    ['a number', encodeJson([7])],
    ['two items', encodeJson(['ada', 'extra'])],
    ['a post cursor', encodeJson(['2026-09-24T10:00:00.000Z', 'post-1'])],
  ])('rejects %s with 400 Invalid cursor', (_label, cursor) => {
    expect(() => decodeUsernameCursor(cursor)).toThrow(
      new BadRequestException('Invalid cursor'),
    );
  });
});
