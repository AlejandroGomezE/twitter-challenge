import { Expose, Type } from 'class-transformer';
import { FollowUserResponseDto } from './follow-user-response.dto.js';

// One page of GET /users/:username/followers or /following, most recent
// follow first. Only @Expose()d fields are ever serialized.
export class FollowUserPageResponseDto {
  // @Type is REQUIRED on nested arrays: without it each item would be copied
  // as an untyped plain object, bypassing FollowUserResponseDto's @Expose()
  // whitelist (and leaking the id). Covered by
  // dto/__tests__/follow-user-response.dto.spec.ts.
  @Expose()
  @Type(() => FollowUserResponseDto)
  items: FollowUserResponseDto[];

  // Pass it back as `?cursor=` for the next page; null on the last page.
  @Expose()
  nextCursor: string | null;
}
