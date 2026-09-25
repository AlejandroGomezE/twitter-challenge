import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPostsQueryDto } from '../list-posts-query.dto.js';

// Same transform + validation the global ValidationPipe applies to a query
// string (every value arrives as a string).
async function check(
  query: Record<string, unknown>,
): Promise<{ dto: ListPostsQueryDto; errors: string[] }> {
  const dto = plainToInstance(ListPostsQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors: errors.map((error) => error.property) };
}

describe('ListPostsQueryDto', () => {
  it('accepts an empty query', async () => {
    await expect(check({})).resolves.toMatchObject({ errors: [] });
  });

  it('accepts a cursor and converts limit to a number', async () => {
    const { dto, errors } = await check({ cursor: 'abc', limit: '35' });

    expect(errors).toEqual([]);
    expect(dto.cursor).toBe('abc');
    expect(dto.limit).toBe(35);
  });

  it.each(['0', '51', '2.5', 'abc'])('rejects limit=%s', async (limit) => {
    await expect(check({ limit })).resolves.toMatchObject({
      errors: ['limit'],
    });
  });

  it('rejects a repeated cursor (array)', async () => {
    await expect(check({ cursor: ['a', 'b'] })).resolves.toMatchObject({
      errors: ['cursor'],
    });
  });
});
