import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { THROTTLE_TTL_MS, USER_THROTTLER } from '../../auth/throttlers.js';
import { CreatePostDto } from './dto/create-post.dto.js';
import { LikeStateResponseDto } from './dto/like-state-response.dto.js';
import { PostResponseDto } from './dto/post-response.dto.js';
import { PostsService } from './posts.service.js';

const CREATE_POST_LIMIT_PER_MINUTE = 10;

// Every route is gated by the global AuthGuard (no @Public()). Author and
// viewer ids come only from the session, never from the request.
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // Rate-limited per session user by the 'user' throttler (auth/throttlers.ts).
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    [USER_THROTTLER]: {
      limit: CREATE_POST_LIMIT_PER_MINUTE,
      ttl: THROTTLE_TTL_MS,
    },
  })
  @SerializeOptions({ type: PostResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    return this.postsService.create(user.id, dto.body);
  }

  @Get(':id')
  @SerializeOptions({ type: PostResponseDto })
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PostResponseDto> {
    return this.postsService.getById(id, user.id);
  }

  // Only the author may delete (403 otherwise); 404 if missing. No body.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.postsService.delete(id, user.id);
  }

  // Idempotent like as the session user; 404 if the post is missing. Not
  // rate-limited (idempotent and cheap).
  @Put(':id/like')
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ type: LikeStateResponseDto })
  like(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<LikeStateResponseDto> {
    return this.postsService.setLiked(id, user.id, true);
  }

  // Idempotent unlike as the session user; 404 if the post is missing.
  @Delete(':id/like')
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ type: LikeStateResponseDto })
  unlike(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<LikeStateResponseDto> {
    return this.postsService.setLiked(id, user.id, false);
  }
}
