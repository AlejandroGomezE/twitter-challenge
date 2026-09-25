import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { SUGGESTIONS_MAX_LIMIT } from '../follows.service.js';

// Query of GET /users/me/suggestions.
export class SuggestionsQueryDto {
  // How many users, 1..10 (default 3). Query strings are strings, hence @Type.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUGGESTIONS_MAX_LIMIT)
  limit?: number;
}
