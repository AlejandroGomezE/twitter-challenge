import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import {
  IsDisplayName,
  IsUsername,
} from '../../modules/users/username.rules.js';
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

  // Required. Trimmed and validated against the shared rules (1–50 code
  // points, no line breaks).
  @IsDisplayName()
  displayName: string;

  @IsString()
  @Length(12, 128)
  password: string;
}
