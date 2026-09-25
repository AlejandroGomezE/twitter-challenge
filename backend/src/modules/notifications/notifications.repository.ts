import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CursorPosition } from '../posts/pagination.js';

// Columns a notification row needs, with its actor, post and comment in the
// same query (no lookup per row). The actor carries no id or email.
const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  createdAt: true,
  readAt: true,
  actor: { select: { username: true, displayName: true } },
  post: { select: { id: true, body: true } },
  comment: { select: { id: true, body: true } },
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_SELECT;
}>;

export interface CreateNotificationData {
  type: string;
  recipientId: string;
  actorId: string;
  postId?: string;
  commentId?: string;
}

// Identifies the notification(s) a retracted action created.
export interface NotificationMatch {
  type: string;
  recipientId: string;
  actorId: string;
  postId?: string;
}

export interface FindNotificationPageParams {
  recipientId: string;
  // Position (createdAt, id) of the last row of the previous page; omitted
  // for the first.
  cursor?: CursorPosition;
  limit: number;
}

// Data access for notifications. Every read and update is scoped by
// `recipientId`, which leads the (recipientId, createdAt) index.
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Rethrows any error (e.g. P2003 when the actor, recipient, post or
  // comment was deleted meanwhile) for the caller to handle.
  async create(data: CreateNotificationData): Promise<void> {
    await this.prisma.notification.create({ data, select: { id: true } });
  }

  // Deleting nothing is fine (idempotent).
  async deleteMatching(match: NotificationMatch): Promise<void> {
    await this.prisma.notification.deleteMany({ where: match });
  }

  // `recipientId`'s notifications, newest first (createdAt DESC, id DESC),
  // strictly after `cursor`. Returns up to `limit + 1` rows: the extra row
  // only tells the caller that a next page exists.
  findPage(params: FindNotificationPageParams): Promise<NotificationRow[]> {
    const { recipientId, cursor, limit } = params;
    const where: Prisma.NotificationWhereInput = { recipientId };
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }
    return this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: NOTIFICATION_SELECT,
    });
  }

  countUnread(recipientId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId, readAt: null },
    });
  }

  // Marks `recipientId`'s unread notifications created at or before `until`
  // as read at `readAt`; already-read rows keep their original readAt.
  async markReadUntil(
    recipientId: string,
    until: Date,
    readAt: Date,
  ): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null, createdAt: { lte: until } },
      data: { readAt },
    });
  }
}
