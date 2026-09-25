import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DISPLAY_NAME_MAX_LENGTH } from '../../../modules/users/username.rules.js';
import { SignUpDto } from '../sign-up.dto.js';

const VALID = {
  email: 'user@example.test',
  username: 'someone',
  displayName: 'Some One',
  password: 'correct horse battery staple',
};

// Same order the global ValidationPipe uses: transform, then validate.
function check(body: object): { value: SignUpDto; failed: string[] } {
  const value = plainToInstance(SignUpDto, body);
  const failed = validateSync(value, { whitelist: true }).map(
    (error) => error.property,
  );
  return { value, failed };
}

describe('SignUpDto', () => {
  it('accepts a valid body and trims the display name', () => {
    const { value, failed } = check({ ...VALID, displayName: '  Ada  ' });

    expect(failed).toEqual([]);
    expect(value.displayName).toBe('Ada');
  });

  it('requires a display name', () => {
    const { displayName: _omitted, ...withoutDisplayName } = VALID;

    expect(check(withoutDisplayName).failed).toEqual(['displayName']);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['too long', 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)],
    ['multi-line', 'Some\nOne'],
    ['a number', 42],
    ['null', null],
  ])('rejects a %s display name', (_label, displayName) => {
    expect(check({ ...VALID, displayName }).failed).toEqual(['displayName']);
  });
});
