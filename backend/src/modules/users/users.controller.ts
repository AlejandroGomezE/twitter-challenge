import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ListPostsQueryDto } from '../posts/dto/list-posts-query.dto.js';
import { PostPageResponseDto } from '../posts/dto/post-page-response.dto.js';
import { MyProfileResponseDto } from './dto/my-profile-response.dto.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

// Every route is gated by the global AuthGuard (no @Public()).
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Declared before `:username` for clarity. The methods differ (PATCH vs
  // GET), so this route can never be captured by the profile lookup. A
  // `GET /users/me` reaches getProfile('me'), which is a 404 because `me` is
  // a reserved username no account can hold.
  @Patch('me')
  @SerializeOptions({ type: MyProfileResponseDto })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MyProfileResponseDto> {
    // The target id comes only from the session, never from the request.
    return this.usersService.updateProfile(user.id, {
      username: dto.username,
      bio: dto.bio,
    });
  }

  // Any signed-in user may view any profile; never includes the email. The
  // service normalizes the username (case-insensitive lookup); the session
  // user is the viewer the follow booleans are relative to.
  @Get(':username')
  @SerializeOptions({ type: ProfileResponseDto })
  getProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<ProfileResponseDto> {
    return this.usersService.getProfile(username, user.id);
  }

  // A user's posts, newest first, paged (the profile Posts tab). Lives here,
  // not in PostsController, because it is a sub-resource of /users/:username;
  // two path segments, so it never collides with GET /users/:username or
  // PATCH /users/me. `GET /users/me/posts` is a 404 like `GET /users/me`.
  @Get(':username/posts')
  @SerializeOptions({ type: PostPageResponseDto })
  listPosts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
    @Query() query: ListPostsQueryDto,
  ): Promise<PostPageResponseDto> {
    return this.usersService.listPosts(username, user.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
