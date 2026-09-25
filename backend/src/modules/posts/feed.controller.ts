import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ListPostsQueryDto } from './dto/list-posts-query.dto.js';
import { PostPageResponseDto } from './dto/post-page-response.dto.js';
import { PostsService } from './posts.service.js';

// Gated by the global AuthGuard (no @Public()). The feed is always the
// session user's; no user id is ever read from the request.
@Controller('feed')
export class FeedController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @SerializeOptions({ type: PostPageResponseDto })
  feed(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPostsQueryDto,
  ): Promise<PostPageResponseDto> {
    return this.postsService.feed(user.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
