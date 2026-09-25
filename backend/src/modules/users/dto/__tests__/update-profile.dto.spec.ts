import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DISPLAY_NAME_MAX_LENGTH } from '../../username.rules.js';
import { UpdateProfileDto } from '../update-profile.dto.js';

// Same order the global ValidationPipe uses: transform, then validate.
function check(body: object): { value: UpdateProfileDto; failed: string[] } {
  const value = plainToInstance(UpdateProfileDto, body);
  const failed = validateSync(value, { whitelist: true }).map(
    (error) => error.property,
  );
  return { value, failed };
}

describe('UpdateProfileDto', () => {
  it('accepts an empty body (display name omitted = unchanged)', () => {
    const { value, failed } = check({});

    expect(failed).toEqual([]);
    expect(value.displayName).toBeUndefined();
  });

  it('accepts a display name on its own and trims it', () => {
    const { value, failed } = check({ displayName: '  Ada Lovelace ' });

    expect(failed).toEqual([]);
    expect(value.displayName).toBe('Ada Lovelace');
  });

  it(`accepts ${DISPLAY_NAME_MAX_LENGTH} code points of emoji`, () => {
    expect(
      check({ displayName: '\u{1F600}'.repeat(DISPLAY_NAME_MAX_LENGTH) })
        .failed,
    ).toEqual([]);
  });

  // A display name can be changed but never cleared.
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['null', null],
    ['too long', 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)],
    ['multi-line', 'Ada\r\nLovelace'],
    ['a number', 7],
  ])('rejects a %s display name', (_label, displayName) => {
    expect(check({ displayName }).failed).toEqual(['displayName']);
  });
});
