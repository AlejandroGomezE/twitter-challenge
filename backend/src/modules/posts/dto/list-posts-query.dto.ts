import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../pagination.js';

// Query of a paged post listing (GET /feed, GET /users/:username/posts).
// The cursor's contents are checked by the service (400 `Invalid cursor`).
export class ListPostsQueryDto {
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
