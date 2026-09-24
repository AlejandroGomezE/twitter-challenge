import { IsOptional } from 'class-validator';
import { IsBio, IsUsername } from '../username.rules.js';

// Body of PATCH /users/me. Both fields are optional; an empty body is a valid
// no-op. Unknown fields are stripped by the global ValidationPipe whitelist.
export class UpdateProfileDto {
  // Normalized (trim + lowercase) and validated against the shared rules.
  @IsOptional()
  @IsUsername()
  username?: string;

  // Trimmed; an empty string (or null) clears the bio.
  @IsBio()
  bio?: string | null;
}
