import { Logger } from '@nestjs/common';
import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { DomainEvent } from '../../../common/events/domain-events.js';
import { FollowsService } from '../../follows/follows.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { PostsService } from '../../posts/posts.service.js';
import { RealtimeHub } from '../realtime.hub.js';
import { RealtimeListener } from '../realtime.listener.js';

const AUTHOR_ID = 'user-author';
const ACTOR_ID = 'user-actor';
const RECIPIENT_ID = 'user-recipient';
const OTHER_ID = 'user-other';
const POST_ID = 'post-1';

// The listener with the hub and the three services mocked (no database, no
// streams).
describe('RealtimeListener', () => {
  let listener: RealtimeListener;

  const hub = {
    connectedUserIds: vi.fn(),
    sendToUser: vi.fn(),
    broadcast: vi.fn(),
  };
  const postsService = { counts: vi.fn() };
  const followsService = { followerIdsAmong: vi.fn() };
  const notificationsService = { unreadCount: vi.fn() };
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    hub.connectedUserIds.mockReturnValue([]);
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeListener,
        { provide: RealtimeHub, useValue: hub },
        { provide: PostsService, useValue: postsService },
        { provide: FollowsService, useValue: followsService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();
    listener = moduleRef.get(RealtimeListener);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it('subscribes every handler asynchronously to its domain event', () => {
    const expected: [keyof RealtimeListener, string][] = [
      ['onPostCreated', DomainEvent.PostCreated],
      ['onPostDeleted', DomainEvent.PostDeleted],
      ['onLikeCreated', DomainEvent.LikeCreated],
      ['onLikeRemoved', DomainEvent.LikeRemoved],
      ['onCommentCreated', DomainEvent.CommentCreated],
      ['onCommentRemoved', DomainEvent.CommentRemoved],
      ['onNotificationChanged', DomainEvent.NotificationChanged],
    ];
    for (const [method, event] of expected) {
      const metadata = Reflect.getMetadata(
        EVENT_LISTENER_METADATA,
        RealtimeListener.prototype[method],
      ) as { event: string; options: { async?: boolean } }[];
      expect(metadata).toEqual([
        expect.objectContaining({
          event,
          options: expect.objectContaining({ async: true }),
        }),
      ]);
    }
  });

  describe('post.created', () => {
    it('sends { id, following } to every connected user but the author, from one follower query', async () => {
      hub.connectedUserIds.mockReturnValue([RECIPIENT_ID, AUTHOR_ID, OTHER_ID]);
      followsService.followerIdsAmong.mockResolvedValue([RECIPIENT_ID]);

      await listener.onPostCreated({ postId: POST_ID, authorId: AUTHOR_ID });

      expect(followsService.followerIdsAmong).toHaveBeenCalledTimes(1);
      expect(followsService.followerIdsAmong).toHaveBeenCalledWith(AUTHOR_ID, [
        RECIPIENT_ID,
        OTHER_ID,
      ]);
      expect(hub.sendToUser).toHaveBeenCalledTimes(2);
      expect(hub.sendToUser).toHaveBeenCalledWith(
        RECIPIENT_ID,
        'post.created',
        { id: POST_ID, following: true },
      );
      expect(hub.sendToUser).toHaveBeenCalledWith(OTHER_ID, 'post.created', {
        id: POST_ID,
        following: false,
      });
      expect(hub.broadcast).not.toHaveBeenCalled();
    });

    it('runs no query when only the author (or nobody) is connected', async () => {
      hub.connectedUserIds.mockReturnValue([AUTHOR_ID]);

      await listener.onPostCreated({ postId: POST_ID, authorId: AUTHOR_ID });

      expect(followsService.followerIdsAmong).not.toHaveBeenCalled();
      expect(hub.sendToUser).not.toHaveBeenCalled();
    });

    it('logs a failure and never rethrows', async () => {
      hub.connectedUserIds.mockReturnValue([RECIPIENT_ID]);
      followsService.followerIdsAmong.mockRejectedValue(new Error('db down'));

      await expect(
        listener.onPostCreated({ postId: POST_ID, authorId: AUTHOR_ID }),
      ).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
      expect(hub.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('post.deleted', () => {
    it('broadcasts { id } to everyone but the author', async () => {
      await listener.onPostDeleted({ postId: POST_ID, authorId: AUTHOR_ID });

      expect(hub.broadcast).toHaveBeenCalledTimes(1);
      expect(hub.broadcast).toHaveBeenCalledWith(
        'post.deleted',
        { id: POST_ID },
        { exceptUserId: AUTHOR_ID },
      );
    });

    it('logs a failure and never rethrows', async () => {
      hub.broadcast.mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(
        listener.onPostDeleted({ postId: POST_ID, authorId: AUTHOR_ID }),
      ).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });

  describe('post.counts', () => {
    const cases: [string, () => Promise<void>][] = [
      [
        'like.created',
        () =>
          listener.onLikeCreated({
            actorId: ACTOR_ID,
            recipientId: AUTHOR_ID,
            postId: POST_ID,
          }),
      ],
      [
        'like.removed',
        () =>
          listener.onLikeRemoved({
            actorId: ACTOR_ID,
            recipientId: AUTHOR_ID,
            postId: POST_ID,
          }),
      ],
      [
        'comment.created',
        () =>
          listener.onCommentCreated({
            actorId: ACTOR_ID,
            recipientId: AUTHOR_ID,
            postId: POST_ID,
            commentId: 'comment-1',
          }),
      ],
      [
        'comment.removed',
        () =>
          listener.onCommentRemoved({
            actorId: ACTOR_ID,
            postId: POST_ID,
            commentId: 'comment-1',
          }),
      ],
    ];

    describe.each(cases)('%s', (_event, handle) => {
      it('broadcasts the current counts to everyone but the actor', async () => {
        hub.connectedUserIds.mockReturnValue([ACTOR_ID, RECIPIENT_ID]);
        postsService.counts.mockResolvedValue({
          likeCount: 3,
          commentCount: 2,
        });

        await handle();

        expect(postsService.counts).toHaveBeenCalledWith(POST_ID);
        expect(hub.broadcast).toHaveBeenCalledTimes(1);
        expect(hub.broadcast).toHaveBeenCalledWith(
          'post.counts',
          { id: POST_ID, likeCount: 3, commentCount: 2 },
          { exceptUserId: ACTOR_ID },
        );
      });

      it('runs no query when only the actor (or nobody) is connected', async () => {
        hub.connectedUserIds.mockReturnValue([ACTOR_ID]);

        await handle();

        expect(postsService.counts).not.toHaveBeenCalled();
        expect(hub.broadcast).not.toHaveBeenCalled();
      });

      it('skips a post that no longer exists', async () => {
        hub.connectedUserIds.mockReturnValue([RECIPIENT_ID]);
        postsService.counts.mockResolvedValue(null);

        await handle();

        expect(hub.broadcast).not.toHaveBeenCalled();
        expect(logError).not.toHaveBeenCalled();
      });

      it('logs a failure and never rethrows', async () => {
        hub.connectedUserIds.mockReturnValue([RECIPIENT_ID]);
        postsService.counts.mockRejectedValue(new Error('db down'));

        await expect(handle()).resolves.toBeUndefined();
        expect(logError).toHaveBeenCalledTimes(1);
        expect(hub.broadcast).not.toHaveBeenCalled();
      });
    });
  });

  describe('notification.changed', () => {
    it('sends { unreadCount } to the connected recipient only', async () => {
      hub.connectedUserIds.mockReturnValue([RECIPIENT_ID, OTHER_ID]);
      notificationsService.unreadCount.mockResolvedValue({ count: 5 });

      await listener.onNotificationChanged({ recipientId: RECIPIENT_ID });

      expect(notificationsService.unreadCount).toHaveBeenCalledWith(
        RECIPIENT_ID,
      );
      expect(hub.sendToUser).toHaveBeenCalledTimes(1);
      expect(hub.sendToUser).toHaveBeenCalledWith(
        RECIPIENT_ID,
        'notifications.changed',
        { unreadCount: 5 },
      );
      expect(hub.broadcast).not.toHaveBeenCalled();
    });

    it('runs no query when the recipient is not connected', async () => {
      hub.connectedUserIds.mockReturnValue([OTHER_ID]);

      await listener.onNotificationChanged({ recipientId: RECIPIENT_ID });

      expect(notificationsService.unreadCount).not.toHaveBeenCalled();
      expect(hub.sendToUser).not.toHaveBeenCalled();
    });

    it('logs a failure and never rethrows', async () => {
      hub.connectedUserIds.mockReturnValue([RECIPIENT_ID]);
      notificationsService.unreadCount.mockRejectedValue(new Error('db down'));

      await expect(
        listener.onNotificationChanged({ recipientId: RECIPIENT_ID }),
      ).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
      expect(hub.sendToUser).not.toHaveBeenCalled();
    });
  });
});
