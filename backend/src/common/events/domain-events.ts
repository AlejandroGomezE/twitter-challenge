import type { EventEmitter2 } from '@nestjs/event-emitter';

// Domain events emitted (via EventEmitter2, fire-and-forget) after a write
// succeeds. Emitters only report what happened — including self-actions —
// and listeners decide what to do with it. Import the names from here, never
// as string literals.
export const DomainEvent = {
  LikeCreated: 'like.created',
  LikeRemoved: 'like.removed',
  FollowCreated: 'follow.created',
  FollowRemoved: 'follow.removed',
  CommentCreated: 'comment.created',
  CommentRemoved: 'comment.removed',
  PostCreated: 'post.created',
  PostDeleted: 'post.deleted',
  NotificationChanged: 'notification.changed',
} as const;

export type DomainEventName = (typeof DomainEvent)[keyof typeof DomainEvent];

// `actorId` is always the session user who performed the action; the
// `recipientId` is the user the action is about.

// `like.created` (only when the like row was actually inserted) and
// `like.removed` (on every successful unlike, idempotent). The recipient is
// the post's author.
export interface LikeEventPayload {
  actorId: string;
  recipientId: string;
  postId: string;
}

// `follow.created` (only when the follow row was actually inserted) and
// `follow.removed` (on every successful unfollow). The recipient is the
// followed user.
export interface FollowEventPayload {
  actorId: string;
  recipientId: string;
}

// `comment.created`: the recipient is the commented post's author.
export interface CommentCreatedPayload {
  actorId: string;
  recipientId: string;
  postId: string;
  commentId: string;
}

// `comment.removed`: after a successful comment delete (never on a 403/404).
// `actorId` is the session user who deleted it.
export interface CommentRemovedPayload {
  actorId: string;
  postId: string;
  commentId: string;
}

// `post.created` (once the post is stored) and `post.deleted` (after a
// successful delete, never on a 403/404). `authorId` is the post's author,
// who is also the session user.
export interface PostEventPayload {
  postId: string;
  authorId: string;
}

// `notification.changed`: `recipientId`'s notifications actually changed — a
// row was created, at least one was retracted, or at least one was marked
// read. Never emitted when nothing changed.
export interface NotificationChangedPayload {
  recipientId: string;
}

// Payload type per event name, for typed emit/listen sites.
export interface DomainEventPayloads {
  [DomainEvent.LikeCreated]: LikeEventPayload;
  [DomainEvent.LikeRemoved]: LikeEventPayload;
  [DomainEvent.FollowCreated]: FollowEventPayload;
  [DomainEvent.FollowRemoved]: FollowEventPayload;
  [DomainEvent.CommentCreated]: CommentCreatedPayload;
  [DomainEvent.CommentRemoved]: CommentRemovedPayload;
  [DomainEvent.PostCreated]: PostEventPayload;
  [DomainEvent.PostDeleted]: PostEventPayload;
  [DomainEvent.NotificationChanged]: NotificationChangedPayload;
}

// Emits `name` with a payload type-checked against DomainEventPayloads.
// Fire-and-forget: the return value (whether anyone listened) is ignored.
export function emitDomainEvent<K extends DomainEventName>(
  emitter: EventEmitter2,
  name: K,
  payload: DomainEventPayloads[K],
): void {
  emitter.emit(name, payload);
}
