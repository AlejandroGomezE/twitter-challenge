import { Expose } from 'class-transformer';

// A user in a followers/following list or in the suggestions. Deliberately no
// id or email. Only @Expose()d fields are ever serialized.
export class FollowUserResponseDto {
  @Expose()
  username: string;

  @Expose()
  bio: string | null;

  // The caller follows this user (false on the caller's own row).
  @Expose()
  isFollowing: boolean;

  // This user follows the caller (false on the caller's own row).
  @Expose()
  followsYou: boolean;
}
