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
}
