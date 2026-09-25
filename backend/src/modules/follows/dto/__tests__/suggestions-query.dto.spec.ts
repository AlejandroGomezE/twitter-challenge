import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SuggestionsQueryDto } from '../suggestions-query.dto.js';

// Same transform + validation the global ValidationPipe applies to a query
// string (every value arrives as a string).
async function check(
  query: Record<string, unknown>,
): Promise<{ dto: SuggestionsQueryDto; errors: string[] }> {
  const dto = plainToInstance(SuggestionsQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors: errors.map((error) => error.property) };
}

describe('SuggestionsQueryDto', () => {
  it('accepts an empty query (the service defaults to 3)', async () => {
    const { dto, errors } = await check({});

    expect(errors).toEqual([]);
    expect(dto.limit).toBeUndefined();
  });

  it.each([
    ['1', 1],
    ['10', 10],
  ])('converts limit=%s to a number', async (limit, expected) => {
    const { dto, errors } = await check({ limit });

    expect(errors).toEqual([]);
    expect(dto.limit).toBe(expected);
  });

  it.each(['0', '11', '2.5', 'abc'])('rejects limit=%s', async (limit) => {
    await expect(check({ limit })).resolves.toMatchObject({
      errors: ['limit'],
    });
  });
});
