import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, ValidateBy } from 'class-validator';

// Authoritative post/comment body rules, shared by posts and comments. The
// frontend composer counter must count the same way (code points).

export const BODY_MAX_LENGTH = 280;

export function normalizeBody(value: string): string {
  return value.trim();
}

// Length in Unicode code points, so an emoji such as "😀" (two UTF-16 code
// units) counts as 1. class-validator's @Length/@MaxLength count UTF-16 code
// units, which is why they are not used here.
export function bodyLength(value: string): number {
  return Array.from(value).length;
}

// Body field: trimmed, then a string of 1–280 code points (a blank body is 0
// after trimming, so it is rejected). The @Transform runs in plainToInstance,
// i.e. before class-validator, so the rules are checked against the value
// that will be stored. Non-string input is left as-is for @IsString().
export function IsPostBody(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeBody(value) : value,
    ),
    IsString(),
    ValidateBy({
      name: 'isPostBody',
      validator: {
        validate: (value: unknown): boolean => {
          if (typeof value !== 'string') {
            return false;
          }
          const length = bodyLength(value);
          return length >= 1 && length <= BODY_MAX_LENGTH;
        },
        defaultMessage: (): string =>
          `body must be between 1 and ${BODY_MAX_LENGTH} characters`,
      },
    }),
  );
}
