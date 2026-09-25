import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';
import { MAX_PAGE_SIZE } from '../../posts/pagination.js';

export const SEARCH_QUERY_MIN_LENGTH = 1;
export const SEARCH_QUERY_MAX_LENGTH = 50;

// Trimmed, then one leading `@` stripped (so `@ada` finds ada). The frontend
// mirrors this in `frontend/src/lib/api/search.js` (normalizeSearchQuery).
export function normalizeSearchQuery(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

// Length in Unicode code points, like display names and post bodies.
function isValidSearchQuery(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const length = Array.from(value).length;
  return length >= SEARCH_QUERY_MIN_LENGTH && length <= SEARCH_QUERY_MAX_LENGTH;
}

// Query of GET /search/users. The cursor's contents are checked by the
// service (400 `Invalid cursor`).
export class SearchUsersQueryDto {
  // Required; normalized before validation (the @Transform runs in
  // plainToInstance). Non-string input (e.g. a repeated `q`) is left as-is
  // for @IsString() to reject.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeSearchQuery(value) : value,
  )
  @IsString()
  @ValidateBy({
    name: 'isSearchQuery',
    validator: {
      validate: (value: unknown): boolean => isValidSearchQuery(value),
      defaultMessage: (): string =>
        `q must be between ${SEARCH_QUERY_MIN_LENGTH} and ${SEARCH_QUERY_MAX_LENGTH} characters`,
    },
  })
  q: string;

  // Opaque `nextCursor` of the previous page; omitted for the first page.
  @IsOptional()
  @IsString()
  cursor?: string;

  // Page size, 1..50 (default 20). Query strings are strings, hence @Type.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
