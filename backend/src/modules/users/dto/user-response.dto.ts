import { Expose } from 'class-transformer';

// Public shape of a user. Only @Expose()d fields are ever serialized.
export class UserResponseDto {
  @Expose()
  id: string;

  @Expose()
  email: string;
}
