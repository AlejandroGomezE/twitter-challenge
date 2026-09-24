import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeEmail } from '../../modules/users/users.service.js';

export class SignInDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  // No minimum length on sign-in (policy may change); the max caps the
  // hashing cost an attacker can force per request.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
