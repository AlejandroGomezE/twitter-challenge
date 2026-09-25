import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  normalizeSearchQuery,
  SEARCH_QUERY_MAX_LENGTH,
  SearchUsersQueryDto,
} from '../search-users-query.dto.js';

// Same transform + validation the global ValidationPipe applies to a query
// string (every value arrives as a string).
async function check(
  query: Record<string, unknown>,
): Promise<{ dto: SearchUsersQueryDto; errors: string[] }> {
  const dto = plainToInstance(SearchUsersQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors: errors.map((error) => error.property) };
}

describe('normalizeSearchQuery', () => {
  it.each([
    ['ada', 'ada'],
    ['  Ada  ', 'Ada'],
    ['@ada', 'ada'],
    ['  @ada ', 'ada'],
    ['@@ada', '@ada'],
    ['a@da', 'a@da'],
    ['@', ''],
    ['   ', ''],
  ])('%j -> %j', (raw, expected) => {
    expect(normalizeSearchQuery(raw)).toBe(expected);
  });
});

describe('SearchUsersQueryDto', () => {
  it('accepts a query alone, keeping its case', async () => {
    const { dto, errors } = await check({ q: 'Ada' });

    expect(errors).toEqual([]);
    expect(dto.q).toBe('Ada');
    expect(dto.cursor).toBeUndefined();
    expect(dto.limit).toBeUndefined();
  });

  it('trims the query and strips one leading @', async () => {
    const { dto, errors } = await check({ q: '  @ada_l ' });

    expect(errors).toEqual([]);
    expect(dto.q).toBe('ada_l');
  });

  it('accepts a cursor and converts limit to a number', async () => {
    const { dto, errors } = await check({ q: 'a', cursor: 'abc', limit: '35' });

    expect(errors).toEqual([]);
    expect(dto.cursor).toBe('abc');
    expect(dto.limit).toBe(35);
  });

  it(`accepts ${SEARCH_QUERY_MAX_LENGTH} code points of emoji (counted as code points)`, async () => {
    const q = '\u{1F600}'.repeat(SEARCH_QUERY_MAX_LENGTH);

    await expect(check({ q })).resolves.toMatchObject({ errors: [] });
  });

  it(`accepts ${SEARCH_QUERY_MAX_LENGTH} characters after stripping @ and whitespace`, async () => {
    const q = ` @${'a'.repeat(SEARCH_QUERY_MAX_LENGTH)} `;

    await expect(check({ q })).resolves.toMatchObject({ errors: [] });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['@-only', '@'],
    ['padded @-only', '  @  '],
    ['too long', 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1)],
    [
      'too long in code points',
      '\u{1F600}'.repeat(SEARCH_QUERY_MAX_LENGTH + 1),
    ],
    ['repeated (array)', ['a', 'b']],
    ['a number', 7],
  ])('rejects a %s q', async (_label, q) => {
    await expect(check(q === undefined ? {} : { q })).resolves.toMatchObject({
      errors: ['q'],
    });
  });

  it.each(['0', '51', '2.5', 'abc'])('rejects limit=%s', async (limit) => {
    await expect(check({ q: 'a', limit })).resolves.toMatchObject({
      errors: ['limit'],
    });
  });

  it('rejects a repeated cursor (array)', async () => {
    await expect(check({ q: 'a', cursor: ['a', 'b'] })).resolves.toMatchObject({
      errors: ['cursor'],
    });
  });
});
