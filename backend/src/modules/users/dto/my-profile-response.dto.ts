import { Expose } from 'class-transformer';

// The caller's own profile (email included). Only @Expose()d fields are ever
// serialized.
export class MyProfileResponseDto {
  @Expose()
  id: string;

  @Expose()
  email: string;

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
}
