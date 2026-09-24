import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { IsUsername } from '../../modules/users/username.rules.js';
import { normalizeEmail } from '../../modules/users/users.service.js';

export class SignUpDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  // Normalized (trim + lowercase) and validated against the shared rules.
  @IsUsername()
  username: string;

  @IsString()
  @Length(12, 128)
  password: string;
}
