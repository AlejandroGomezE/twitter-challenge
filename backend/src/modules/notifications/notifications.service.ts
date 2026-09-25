import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DomainEvent,
  emitDomainEvent,
} from '../../common/events/domain-events.js';
import {
  decodeCursor,
  encodeCursor,
  resolvePageSize,
} from '../posts/pagination.js';
import type { PageQuery } from '../posts/posts.service.js';
import {
  type NotificationRow,
  NotificationsRepository,
} from './notifications.repository.js';

// `type` is a plain String column (SQLite has no enums), so the allowed
// values are enforced here.
export const NOTIFICATION_TYPES = ['follow', 'like', 'comment'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// A notification as its recipient sees it.
export interface NotificationView {
  id: string;
  type: NotificationType;
  createdAt: Date;
  read: boolean;
  actor: { username: string; displayName: string | null };
  // The liked / commented-on post; null for a follow.
  post: { id: string; body: string } | null;
  // The comment; set only for a comment notification.
  comment: { id: string; body: string } | null;
}

// One page of notifications, newest first. `nextCursor` is null on the last
// page.
export interface NotificationPage {
  items: NotificationView[];
  nextCursor: string | null;
}

export interface UnreadCount {
  count: number;
}

// What happened, as reported by a domain event.
export interface NotificationInput {
  type: NotificationType;
  recipientId: string;
  actorId: string;
  postId?: string;
  commentId?: string;
}

function isNotificationType(type: string): type is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(type);
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Records a notification for `input.recipientId`. Self-actions (liking or
  // commenting on your own post) never notify. Errors (e.g. P2003 when a
  // referenced row was deleted meanwhile) propagate to the caller. Emits
  // `notification.changed` once the row is stored.
  async notify(input: NotificationInput): Promise<void> {
    if (input.actorId === input.recipientId) {
      return;
    }
    await this.notificationsRepository.create(input);
    this.emitChanged(input.recipientId);
  }

  // Removes the notification(s) an undone like or follow created.
  // Idempotent; a self-action has none to remove. Emits
  // `notification.changed` only when at least one row was removed.
  async retract(input: Omit<NotificationInput, 'commentId'>): Promise<void> {
    if (input.actorId === input.recipientId) {
      return;
    }
    const deleted = await this.notificationsRepository.deleteMatching(input);
    if (deleted > 0) {
      this.emitChanged(input.recipientId);
    }
  }

  // `recipientId`'s notifications, newest first, keyset-paged on
  // (createdAt, id): one query (limit + 1 rows to detect a next page), with
  // actor, post and comment selected alongside. 400 `Invalid cursor` before
  // any query runs.
  async list(recipientId: string, query: PageQuery): Promise<NotificationPage> {
    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const limit = resolvePageSize(query.limit);
    const rows = await this.notificationsRepository.findPage({
      recipientId,
      cursor,
      limit,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return {
      items: page.flatMap((row) => this.toView(row) ?? []),
      nextCursor,
    };
  }

  async unreadCount(recipientId: string): Promise<UnreadCount> {
    const count = await this.notificationsRepository.countUnread(recipientId);
    return { count };
  }

  // Marks `recipientId`'s unread notifications created at or before `until`
  // (an ISO-8601 date, validated by MarkReadDto) as read now. One created
  // later — after the client loaded its page — stays unread. Emits
  // `notification.changed` only when at least one row was marked.
  async markRead(recipientId: string, until: string): Promise<void> {
    const updated = await this.notificationsRepository.markReadUntil(
      recipientId,
      new Date(until),
      new Date(),
    );
    if (updated > 0) {
      this.emitChanged(recipientId);
    }
  }

  private emitChanged(recipientId: string): void {
    emitDomainEvent(this.eventEmitter, DomainEvent.NotificationChanged, {
      recipientId,
    });
  }

  // null (dropped from the page) for a type this code doesn't know; only
  // notify() writes rows, so that never happens in practice.
  private toView(row: NotificationRow): NotificationView | null {
    if (!isNotificationType(row.type)) {
      return null;
    }
    return {
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      read: row.readAt !== null,
      actor: row.actor,
      post: row.post,
      comment: row.comment,
    };
  }
}
