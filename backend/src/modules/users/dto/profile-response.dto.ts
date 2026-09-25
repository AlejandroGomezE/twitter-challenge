import { Expose } from 'class-transformer';

// Another user's profile. Deliberately no id or email. Only @Expose()d
// fields are ever serialized.
export class ProfileResponseDto {
  @Expose()
  username: string;

  @Expose()
  bio: string | null;

  // class-transformer keeps a Date instance as a Date (no @Type needed), so
  // the JSON body carries an ISO-8601 string.
  @Expose()
  createdAt: Date;

  // Number of posts the user has written.
  @Expose()
  postCount: number;

  // Number of users following this user.
  @Expose()
  followerCount: number;

  // Number of users this user follows.
  @Expose()
  followingCount: number;

  // The caller follows this user (false on the caller's own profile).
  @Expose()
  isFollowing: boolean;

  // This user follows the caller (false on the caller's own profile).
  @Expose()
  followsYou: boolean;
}
