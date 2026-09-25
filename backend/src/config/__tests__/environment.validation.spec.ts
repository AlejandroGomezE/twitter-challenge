import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { validate } from '../environment.validation.js';

const ENV_EXAMPLE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.env.example',
);

describe('validate', () => {
  // `cp .env.example .env` is the documented first step, so the example must boot as-is.
  it('accepts backend/.env.example unedited', () => {
    const config = parse(readFileSync(ENV_EXAMPLE, 'utf8'));

    expect(validate(config)).toMatchObject({ PORT: 3000 });
  });

  it('defaults PORT to 3000 when it is absent', () => {
    expect(validate({ DATABASE_URL: 'file:./dev.db' }).PORT).toBe(3000);
  });

  // An empty value is not "absent": it coerces to 0, which is rejected.
  it('rejects an empty PORT', () => {
    expect(() => validate({ DATABASE_URL: 'file:./dev.db', PORT: '' })).toThrow(/PORT/);
  });
});
