import { Expose, Type } from 'class-transformer';
import { FollowUserResponseDto } from './follow-user-response.dto.js';

// GET /users/me/suggestions: an unpaged, short list of users. Only
// @Expose()d fields are ever serialized.
export class FollowUserListResponseDto {
  // @Type is REQUIRED on nested arrays (see FollowUserPageResponseDto).
  @Expose()
  @Type(() => FollowUserResponseDto)
  items: FollowUserResponseDto[];
}
