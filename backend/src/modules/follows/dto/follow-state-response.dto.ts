import { Expose } from 'class-transformer';

// The caller's follow state on a user after PUT/DELETE
// /users/:username/follow, with the target's new follower total.
export class FollowStateResponseDto {
  @Expose()
  following: boolean;

  @Expose()
  followerCount: number;
}
