import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type CommentCreatedPayload,
  DomainEvent,
  type FollowEventPayload,
  type LikeEventPayload,
} from '../../common/events/domain-events.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationsService } from './notifications.service.js';

// Prisma's code for a foreign-key violation.
const FOREIGN_KEY_VIOLATION = 'P2003';

// Turns domain events into notifications. `async: true` is required on every
// handler: EventEmitter2 runs sync listeners inside emit(), i.e. in the
// originating request's stack, so a failure here could fail the like /
// follow / comment request. Handlers never rethrow — a failure is logged and
// the originating request is unaffected.
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(DomainEvent.LikeCreated, { async: true })
  onLikeCreated(payload: LikeEventPayload): Promise<void> {
    return this.run(DomainEvent.LikeCreated, () =>
      this.notificationsService.notify({
        type: 'like',
        recipientId: payload.recipientId,
        actorId: payload.actorId,
        postId: payload.postId,
      }),
    );
  }

  @OnEvent(DomainEvent.LikeRemoved, { async: true })
  onLikeRemoved(payload: LikeEventPayload): Promise<void> {
    return this.run(DomainEvent.LikeRemoved, () =>
      this.notificationsService.retract({
        type: 'like',
        recipientId: payload.recipientId,
        actorId: payload.actorId,
        postId: payload.postId,
      }),
    );
  }

  @OnEvent(DomainEvent.FollowCreated, { async: true })
  onFollowCreated(payload: FollowEventPayload): Promise<void> {
    return this.run(DomainEvent.FollowCreated, () =>
      this.notificationsService.notify({
        type: 'follow',
        recipientId: payload.recipientId,
        actorId: payload.actorId,
      }),
    );
  }

  @OnEvent(DomainEvent.FollowRemoved, { async: true })
  onFollowRemoved(payload: FollowEventPayload): Promise<void> {
    return this.run(DomainEvent.FollowRemoved, () =>
      this.notificationsService.retract({
        type: 'follow',
        recipientId: payload.recipientId,
        actorId: payload.actorId,
      }),
    );
  }

  @OnEvent(DomainEvent.CommentCreated, { async: true })
  onCommentCreated(payload: CommentCreatedPayload): Promise<void> {
    return this.run(DomainEvent.CommentCreated, () =>
      this.notificationsService.notify({
        type: 'comment',
        recipientId: payload.recipientId,
        actorId: payload.actorId,
        postId: payload.postId,
        commentId: payload.commentId,
      }),
    );
  }

  // Runs `work`, swallowing every error. A P2003 means the post, comment or
  // a user was deleted between the write and this listener — the cascade
  // would have removed the notification anyway, so it's a silent no-op.
  private async run(event: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        return;
      }
      this.logger.error(
        `Failed to handle ${event}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
