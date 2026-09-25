import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { FollowUserPageResponseDto } from '../follows/dto/follow-user-page-response.dto.js';
import { SearchUsersQueryDto } from './dto/search-users-query.dto.js';
import { UsersService } from './users.service.js';

// Search lives under /search, not /users: `search` isn't a reserved username,
// so `/users/search` would shadow a user called "search". It searches users,
// so it belongs to the users module.
//
// Every route is gated by the global AuthGuard (no @Public()); the viewer the
// follow booleans are relative to is the session user.
@Controller('search')
export class SearchController {
  constructor(private readonly usersService: UsersService) {}

  // Users whose username or display name contains `q`, ordered by username,
  // paged. 400 for a bad `q`, `limit` or cursor.
  @Get('users')
  @SerializeOptions({ type: FollowUserPageResponseDto })
  searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchUsersQueryDto,
  ): Promise<FollowUserPageResponseDto> {
    return this.usersService.searchUsers(user.id, query.q, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
