import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsNotIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

// Authoritative username/bio rules. The frontend mirrors them in
// `frontend/src/lib/validation/profile-schemas.js` — keep both in sync.

// Words that would collide with app routes or API paths. The frontend copy
// (`RESERVED_USERNAMES` in `frontend/src/lib/validation/profile-schemas.js`)
// MUST match this list.
export const RESERVED_USERNAMES: readonly string[] = [
  'me',
  'settings',
  'sign-in',
  'sign-up',
  'sign-out',
  'auth',
  'users',
  'u',
  'api',
  'admin',
  'root',
];

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_PATTERN = /^[a-z0-9_]+$/;
export const BIO_MAX_LENGTH = 160;

// Usernames are stored lowercase, so the DB unique index is effectively
// case-insensitive.
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

// An empty (or whitespace-only) bio clears it: stored as null.
export function normalizeBio(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// DTO building blocks. The @Transform runs in plainToInstance, i.e. before
// class-validator, so the rules are checked against the normalized value
// that will be stored. Non-string input is left as-is for @IsString() to
// reject.

// Username field: normalized, 3–20 chars of [a-z0-9_], not reserved. Add
// @IsOptional() on the DTO field when the username may be omitted.
export function IsUsername(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeUsername(value) : value,
    ),
    IsString(),
    Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH, {
      message: `username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`,
    }),
    Matches(USERNAME_PATTERN, {
      message: 'username may only contain letters, numbers and underscores',
    }),
    IsNotIn([...RESERVED_USERNAMES], { message: 'username is not available' }),
  );
}

// Bio field: always optional; trimmed, an empty string becomes null (which
// clears the bio), max 160 chars.
export function IsBio(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeBio(value) : value,
    ),
    IsOptional(),
    IsString(),
    MaxLength(BIO_MAX_LENGTH, {
      message: `bio must be at most ${BIO_MAX_LENGTH} characters`,
    }),
  );
}
