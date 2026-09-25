import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/authenticated-user.interface.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ListPostsQueryDto } from '../posts/dto/list-posts-query.dto.js';
import { MarkReadDto } from './dto/mark-read.dto.js';
import { NotificationPageResponseDto } from './dto/notification-page-response.dto.js';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto.js';
import { NotificationsService } from './notifications.service.js';

// Every route is gated by the global AuthGuard (no @Public()) and always
// reads or updates the session user's own notifications; no user id is ever
// read from the request. All paths are literal (no param routes).
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @SerializeOptions({ type: NotificationPageResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPostsQueryDto,
  ): Promise<NotificationPageResponseDto> {
    return this.notificationsService.list(user.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('unread-count')
  @SerializeOptions({ type: UnreadCountResponseDto })
  unreadCount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsService.unreadCount(user.id);
  }

  // Marks the caller's notifications created up to `until` as read. No body.
  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkReadDto,
  ): Promise<void> {
    return this.notificationsService.markRead(user.id, dto.until);
  }
}
