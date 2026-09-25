import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MarkReadDto } from '../mark-read.dto.js';

// Same transform + validation the global ValidationPipe applies to a body.
async function errorsFor(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(MarkReadDto, body);
  const errors = await validate(dto, { whitelist: true });
  return errors.map((error) => error.property);
}

describe('MarkReadDto', () => {
  it.each(['2026-09-24T10:00:00.000Z', '2026-09-24T10:00:00+02:00'])(
    'accepts until=%s',
    async (until) => {
      await expect(errorsFor({ until })).resolves.toEqual([]);
    },
  );

  it.each([
    ['missing', {}],
    ['null', { until: null }],
    ['a number', { until: 1_727_000_000_000 }],
    ['not a date', { until: 'yesterday' }],
    ['an impossible date', { until: '2026-02-30T10:00:00.000Z' }],
    ['empty', { until: '' }],
  ])('rejects until when %s', async (_label, body) => {
    await expect(errorsFor(body)).resolves.toEqual(['until']);
  });
});
