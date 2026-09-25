import { IsOptional, ValidateIf } from 'class-validator';
import { IsBio, IsDisplayName, IsUsername } from '../username.rules.js';

// Body of PATCH /users/me. All fields are optional; an empty body is a valid
// no-op. Unknown fields are stripped by the global ValidationPipe whitelist.
export class UpdateProfileDto {
  // Normalized (trim + lowercase) and validated against the shared rules.
  @IsOptional()
  @IsUsername()
  username?: string;

  // Trimmed; an empty string (or null) clears the bio.
  @IsBio()
  bio?: string | null;

  // Trimmed; sets or changes the display name. It can't be cleared: '',
  // whitespace-only and null are rejected (400). Omitted = unchanged.
  @ValidateIf((dto: UpdateProfileDto) => dto.displayName !== undefined)
  @IsDisplayName()
  displayName?: string;
}
