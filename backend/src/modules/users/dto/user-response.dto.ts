import { Expose } from 'class-transformer';

// Public shape of a user. Only @Expose()d fields are ever serialized.
export class UserResponseDto {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Expose()
  username: string;

  // null for accounts created before display names existed.
  @Expose()
  displayName: string | null;
}
