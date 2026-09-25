import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type CommentCreatedPayload,
  type CommentRemovedPayload,
  DomainEvent,
  type LikeEventPayload,
  type NotificationChangedPayload,
  type PostEventPayload,
} from '../../common/events/domain-events.js';
import { FollowsService } from '../follows/follows.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PostsService } from '../posts/posts.service.js';
import { RealtimeEvent } from './realtime.constants.js';
import { RealtimeHub } from './realtime.hub.js';

// Turns domain events into GET /events messages. Payloads are exactly the
// stream contract's shapes — never author ids or other user data. The
// author/actor is skipped because their own client has already applied the
// change optimistically. No query runs when nobody who would receive the
// message is connected.
//
// `async: true` is required on every handler: EventEmitter2 runs sync
// listeners inside emit(), i.e. in the originating request's stack, so a
// failure here could fail that request. Handlers never rethrow — a failure is
// logged and the originating request is unaffected.
@Injectable()
export class RealtimeListener {
  private readonly logger = new Logger(RealtimeListener.name);

  constructor(
    private readonly hub: RealtimeHub,
    private readonly postsService: PostsService,
    private readonly followsService: FollowsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // `post.created` { id, following } to every connected user except the
  // author; `following` comes from one query for all connected candidates.
  @OnEvent(DomainEvent.PostCreated, { async: true })
  onPostCreated(payload: PostEventPayload): Promise<void> {
    return this.run(DomainEvent.PostCreated, async () => {
      const recipients = this.hub
        .connectedUserIds()
        .filter((userId) => userId !== payload.authorId);
      if (recipients.length === 0) {
        return;
      }
      const followers = new Set(
        await this.followsService.followerIdsAmong(
          payload.authorId,
          recipients,
        ),
      );
      for (const userId of recipients) {
        this.hub.sendToUser(userId, RealtimeEvent.PostCreated, {
          id: payload.postId,
          following: followers.has(userId),
        });
      }
    });
  }

  // `post.deleted` { id } to every connected user except the author.
  @OnEvent(DomainEvent.PostDeleted, { async: true })
  onPostDeleted(payload: PostEventPayload): Promise<void> {
    return this.run(DomainEvent.PostDeleted, () => {
      this.hub.broadcast(
        RealtimeEvent.PostDeleted,
        { id: payload.postId },
        { exceptUserId: payload.authorId },
      );
      return Promise.resolve();
    });
  }

  @OnEvent(DomainEvent.LikeCreated, { async: true })
  onLikeCreated(payload: LikeEventPayload): Promise<void> {
    return this.run(DomainEvent.LikeCreated, () =>
      this.pushCounts(payload.postId, payload.actorId),
    );
  }

  @OnEvent(DomainEvent.LikeRemoved, { async: true })
  onLikeRemoved(payload: LikeEventPayload): Promise<void> {
    return this.run(DomainEvent.LikeRemoved, () =>
      this.pushCounts(payload.postId, payload.actorId),
    );
  }

  @OnEvent(DomainEvent.CommentCreated, { async: true })
  onCommentCreated(payload: CommentCreatedPayload): Promise<void> {
    return this.run(DomainEvent.CommentCreated, () =>
      this.pushCounts(payload.postId, payload.actorId),
    );
  }

  @OnEvent(DomainEvent.CommentRemoved, { async: true })
  onCommentRemoved(payload: CommentRemovedPayload): Promise<void> {
    return this.run(DomainEvent.CommentRemoved, () =>
      this.pushCounts(payload.postId, payload.actorId),
    );
  }

  // `notifications.changed` { unreadCount } to the recipient only.
  @OnEvent(DomainEvent.NotificationChanged, { async: true })
  onNotificationChanged(payload: NotificationChangedPayload): Promise<void> {
    return this.run(DomainEvent.NotificationChanged, async () => {
      if (!this.isConnected(payload.recipientId)) {
        return;
      }
      const { count } = await this.notificationsService.unreadCount(
        payload.recipientId,
      );
      this.hub.sendToUser(
        payload.recipientId,
        RealtimeEvent.NotificationsChanged,
        { unreadCount: count },
      );
    });
  }

  // `post.counts` { id, likeCount, commentCount } to every connected user
  // except the actor. Skipped when the post no longer exists.
  private async pushCounts(postId: string, actorId: string): Promise<void> {
    const anyRecipient = this.hub
      .connectedUserIds()
      .some((userId) => userId !== actorId);
    if (!anyRecipient) {
      return;
    }
    const counts = await this.postsService.counts(postId);
    if (!counts) {
      return;
    }
    this.hub.broadcast(
      RealtimeEvent.PostCounts,
      {
        id: postId,
        likeCount: counts.likeCount,
        commentCount: counts.commentCount,
      },
      { exceptUserId: actorId },
    );
  }

  private isConnected(userId: string): boolean {
    return this.hub.connectedUserIds().includes(userId);
  }

  // Runs `work`, swallowing (and logging) every error.
  private async run(event: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        `Failed to handle ${event}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
