import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePostDto } from '../dto/create-post.dto.js';
import { BODY_MAX_LENGTH, bodyLength, normalizeBody } from '../posts.rules.js';

// Same order the global ValidationPipe uses: transform, then validate.
function check(body: object): { value: CreatePostDto; errors: string[] } {
  const value = plainToInstance(CreatePostDto, body);
  const errors = validateSync(value).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  return { value, errors };
}

const EMOJI = '😀'; // one code point, two UTF-16 code units

describe('body rules', () => {
  it('normalizeBody trims surrounding whitespace, keeping inner line breaks', () => {
    expect(normalizeBody('  hello\nworld \n')).toBe('hello\nworld');
  });

  it('bodyLength counts Unicode code points (an emoji is 1)', () => {
    expect(EMOJI.length).toBe(2);
    expect(bodyLength(EMOJI)).toBe(1);
    expect(bodyLength(`a${EMOJI}b`)).toBe(3);
  });
});

describe('@IsPostBody()', () => {
  it('accepts a body and stores it trimmed', () => {
    const { value, errors } = check({ body: '  hello world  ' });
    expect(errors).toEqual([]);
    expect(value.body).toBe('hello world');
  });

  it(`accepts exactly ${BODY_MAX_LENGTH} characters`, () => {
    expect(check({ body: 'a'.repeat(BODY_MAX_LENGTH) }).errors).toEqual([]);
  });

  it(`rejects ${BODY_MAX_LENGTH + 1} characters`, () => {
    expect(check({ body: 'a'.repeat(BODY_MAX_LENGTH + 1) }).errors).toEqual([
      `body must be between 1 and ${BODY_MAX_LENGTH} characters`,
    ]);
  });

  it(`accepts ${BODY_MAX_LENGTH} emoji (${BODY_MAX_LENGTH * 2} UTF-16 units)`, () => {
    expect(check({ body: EMOJI.repeat(BODY_MAX_LENGTH) }).errors).toEqual([]);
  });

  it(`rejects ${BODY_MAX_LENGTH + 1} emoji`, () => {
    expect(
      check({ body: EMOJI.repeat(BODY_MAX_LENGTH + 1) }).errors,
    ).toHaveLength(1);
  });

  it('measures the length after trimming', () => {
    const padded = `   ${'a'.repeat(BODY_MAX_LENGTH)}   `;
    expect(check({ body: padded }).errors).toEqual([]);
  });

  it.each(['', '   ', '\n\t  \n'])('rejects a blank body (%j)', (body) => {
    expect(check({ body }).errors).toHaveLength(1);
  });

  it.each([[undefined], [null], [42], [['hi']]])(
    'rejects a non-string body (%j)',
    (body) => {
      expect(check({ body }).errors).toContain('body must be a string');
    },
  );
});
