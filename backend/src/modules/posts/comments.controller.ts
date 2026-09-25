import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { THROTTLE_TTL_MS, USER_THROTTLER } from '../../auth/throttlers.js';
import { CommentsService } from './comments.service.js';
import { CommentPageResponseDto } from './dto/comment-page-response.dto.js';
import { CommentResponseDto } from './dto/comment-response.dto.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { ListPostsQueryDto } from './dto/list-posts-query.dto.js';

const CREATE_COMMENT_LIMIT_PER_MINUTE = 20;

// A post's comments. Every route is gated by the global AuthGuard (no
// @Public()); the author id comes only from the session. These paths have
// one more segment than PostsController's `:id` and a literal `comments`
// where it has `like`, so the two never clash.
@Controller('posts/:postId/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  // Oldest first, cursor-paged; 404 if the post is missing.
  @Get()
  @SerializeOptions({ type: CommentPageResponseDto })
  list(
    @Param('postId') postId: string,
    @Query() query: ListPostsQueryDto,
  ): Promise<CommentPageResponseDto> {
    return this.commentsService.list(postId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  // Rate-limited per session user by the 'user' throttler (auth/throttlers.ts).
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    [USER_THROTTLER]: {
      limit: CREATE_COMMENT_LIMIT_PER_MINUTE,
      ttl: THROTTLE_TTL_MS,
    },
  })
  @SerializeOptions({ type: CommentResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.commentsService.create(postId, user.id, dto.body);
  }

  // Only the comment's author may delete (403 otherwise); 404 if it is
  // missing or on another post. No body.
  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ): Promise<void> {
    return this.commentsService.delete(postId, commentId, user.id);
  }
}
