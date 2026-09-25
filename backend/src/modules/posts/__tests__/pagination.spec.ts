import { BadRequestException } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  PAGE_SIZE,
  resolvePageSize,
} from '../pagination.js';

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

describe('cursor', () => {
  const position = {
    createdAt: new Date('2026-09-24T10:11:12.345Z'),
    id: 'cmabc123def456',
  };

  it('round-trips (createdAt, id)', () => {
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('is opaque base64url (no padding, URL-safe)', () => {
    expect(encodeCursor(position)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'abc+/=='],
    ['not JSON', base64url('not json')],
    ['not an array', base64url('{"createdAt":"2026-09-24T10:11:12.345Z"}')],
    ['wrong arity', base64url('["2026-09-24T10:11:12.345Z"]')],
    ['non-string id', base64url('["2026-09-24T10:11:12.345Z", 5]')],
    ['empty id', base64url('["2026-09-24T10:11:12.345Z", ""]')],
    ['invalid date', base64url('["not-a-date", "id"]')],
    ['non-canonical date', base64url('["2026-09-24", "id"]')],
  ])(
    'rejects a cursor that is %s with 400 Invalid cursor',
    (_label, cursor) => {
      expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
      expect(() => decodeCursor(cursor)).toThrow('Invalid cursor');
    },
  );
});

describe('resolvePageSize', () => {
  it('defaults to PAGE_SIZE', () => {
    expect(resolvePageSize()).toBe(PAGE_SIZE);
    expect(PAGE_SIZE).toBe(20);
  });

  it('uses a requested (DTO-validated) size as is', () => {
    expect(resolvePageSize(35)).toBe(35);
  });
});
