import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  SerializeOptions,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { MyProfileResponseDto } from './dto/my-profile-response.dto.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

// Both routes are gated by the global AuthGuard (no @Public()).
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
  // service normalizes the username (case-insensitive lookup).
  @Get(':username')
  @SerializeOptions({ type: ProfileResponseDto })
  getProfile(@Param('username') username: string): Promise<ProfileResponseDto> {
    return this.usersService.getProfile(username);
  }
}
