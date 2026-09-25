import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { THROTTLE_TTL_MS, USER_THROTTLER } from '../../auth/throttlers.js';
import { ListPostsQueryDto } from '../posts/dto/list-posts-query.dto.js';
import { FollowStateResponseDto } from './dto/follow-state-response.dto.js';
import { FollowUserListResponseDto } from './dto/follow-user-list-response.dto.js';
import { FollowUserPageResponseDto } from './dto/follow-user-page-response.dto.js';
import { SuggestionsQueryDto } from './dto/suggestions-query.dto.js';
import { FollowsService } from './follows.service.js';

// Per session user, per route (PUT and DELETE count separately).
const FOLLOW_LIMIT_PER_MINUTE = 30;

const FOLLOW_THROTTLE = {
  [USER_THROTTLER]: { limit: FOLLOW_LIMIT_PER_MINUTE, ttl: THROTTLE_TTL_MS },
};

// Follow routes are sub-resources of /users, so they share the prefix with
// UsersController but live in their own controller: UsersModule will import
// FollowsModule, so FollowsModule can't reach UsersController. No route here
// can shadow (or be shadowed by) a UsersController route, whatever order the
// two controllers are registered in: UsersController only has one-segment
// paths (`GET :username`, `PATCH me`) and `GET :username/posts`, while every
// route here has two segments whose second one (`follow`, `followers`,
// `following`, `suggestions`) is distinct. `me` is a reserved username no
// account can hold, so `/users/me/suggestions` can't clash with a real user's
// path, and `/users/me/followers` etc. are simply 404 `User not found`.
//
// Every route is gated by the global AuthGuard (no @Public()); the caller id
// comes only from the session, never from the request.
@Controller('users')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Get('me/suggestions')
  @SerializeOptions({ type: FollowUserListResponseDto })
  suggestions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SuggestionsQueryDto,
  ): Promise<FollowUserListResponseDto> {
    return this.followsService.suggestions(user.id, query.limit);
  }

  // Idempotent follow as the session user; 404 unknown user, 400 yourself.
  // Rate-limited per session user by the 'user' throttler.
  @Put(':username/follow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle(FOLLOW_THROTTLE)
  @SerializeOptions({ type: FollowStateResponseDto })
  follow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<FollowStateResponseDto> {
    return this.followsService.setFollowing(user.id, username, true);
  }

  // Idempotent unfollow as the session user; same errors and limit as follow.
  @Delete(':username/follow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle(FOLLOW_THROTTLE)
  @SerializeOptions({ type: FollowStateResponseDto })
  unfollow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<FollowStateResponseDto> {
    return this.followsService.setFollowing(user.id, username, false);
  }

  @Get(':username/followers')
  @SerializeOptions({ type: FollowUserPageResponseDto })
  followers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
    @Query() query: ListPostsQueryDto,
  ): Promise<FollowUserPageResponseDto> {
    return this.followsService.listFollowers(username, user.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':username/following')
  @SerializeOptions({ type: FollowUserPageResponseDto })
  following(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
    @Query() query: ListPostsQueryDto,
  ): Promise<FollowUserPageResponseDto> {
    return this.followsService.listFollowing(username, user.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
