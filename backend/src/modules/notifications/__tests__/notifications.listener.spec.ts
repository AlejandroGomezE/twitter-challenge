import { Logger } from '@nestjs/common';
import {
  EVENT_LISTENER_METADATA,
  EventEmitter2,
  EventEmitterModule,
} from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { DomainEvent } from '../../../common/events/domain-events.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { NotificationsListener } from '../notifications.listener.js';
import { NotificationsRepository } from '../notifications.repository.js';
import { NotificationsService } from '../notifications.service.js';

const ACTOR_ID = 'user-actor';
const RECIPIENT_ID = 'user-recipient';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
    code,
    clientVersion: 'test',
  });
}

// The real NotificationsService under the listener, with the repository
// mocked (no database).
describe('NotificationsListener', () => {
  let listener: NotificationsListener;

  const notificationsRepository = {
    create: vi.fn(),
    deleteMatching: vi.fn(),
    findPage: vi.fn(),
    countUnread: vi.fn(),
    markReadUntil: vi.fn(),
  };
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        NotificationsService,
        {
          provide: NotificationsRepository,
          useValue: notificationsRepository,
        },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
      ],
    }).compile();
    listener = moduleRef.get(NotificationsListener);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  describe('creates one notification per event type', () => {
    it('like.created → like on the post', async () => {
      await listener.onLikeCreated({
        actorId: ACTOR_ID,
        recipientId: RECIPIENT_ID,
        postId: 'post-1',
      });

      expect(notificationsRepository.create).toHaveBeenCalledTimes(1);
      expect(notificationsRepository.create).toHaveBeenCalledWith({
        type: 'like',
        recipientId: RECIPIENT_ID,
        actorId: ACTOR_ID,
        postId: 'post-1',
      });
    });

    it('comment.created → comment on the post, with the comment', async () => {
      await listener.onCommentCreated({
        actorId: ACTOR_ID,
        recipientId: RECIPIENT_ID,
        postId: 'post-1',
        commentId: 'comment-1',
      });

      expect(notificationsRepository.create).toHaveBeenCalledWith({
        type: 'comment',
        recipientId: RECIPIENT_ID,
        actorId: ACTOR_ID,
        postId: 'post-1',
        commentId: 'comment-1',
      });
    });

    it('follow.created → follow, with no post or comment', async () => {
      await listener.onFollowCreated({
        actorId: ACTOR_ID,
        recipientId: RECIPIENT_ID,
      });

      expect(notificationsRepository.create).toHaveBeenCalledWith({
        type: 'follow',
        recipientId: RECIPIENT_ID,
        actorId: ACTOR_ID,
      });
    });
  });

  describe('skips self-actions', () => {
    it('never notifies for liking or commenting on your own post', async () => {
      await listener.onLikeCreated({
        actorId: ACTOR_ID,
        recipientId: ACTOR_ID,
        postId: 'post-1',
      });
      await listener.onCommentCreated({
        actorId: ACTOR_ID,
        recipientId: ACTOR_ID,
        postId: 'post-1',
        commentId: 'comment-1',
      });
      await listener.onFollowCreated({
        actorId: ACTOR_ID,
        recipientId: ACTOR_ID,
      });

      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });

    it('has nothing to retract for a self-unlike', async () => {
      await listener.onLikeRemoved({
        actorId: ACTOR_ID,
        recipientId: ACTOR_ID,
        postId: 'post-1',
      });

      expect(notificationsRepository.deleteMatching).not.toHaveBeenCalled();
    });
  });

  describe('retracts on removal', () => {
    it('like.removed deletes the matching like notification', async () => {
      await listener.onLikeRemoved({
        actorId: ACTOR_ID,
        recipientId: RECIPIENT_ID,
        postId: 'post-1',
      });

      expect(notificationsRepository.deleteMatching).toHaveBeenCalledWith({
        type: 'like',
        recipientId: RECIPIENT_ID,
        actorId: ACTOR_ID,
        postId: 'post-1',
      });
    });

    it('follow.removed deletes the matching follow notification', async () => {
      await listener.onFollowRemoved({
        actorId: ACTOR_ID,
        recipientId: RECIPIENT_ID,
      });

      expect(notificationsRepository.deleteMatching).toHaveBeenCalledWith({
        type: 'follow',
        recipientId: RECIPIENT_ID,
        actorId: ACTOR_ID,
      });
    });
  });

  describe('errors', () => {
    it('swallows and logs a failure, never rethrowing', async () => {
      notificationsRepository.create.mockRejectedValue(new Error('db down'));

      await expect(
        listener.onFollowCreated({
          actorId: ACTOR_ID,
          recipientId: RECIPIENT_ID,
        }),
      ).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0]?.[0]).toContain(DomainEvent.FollowCreated);
    });

    it('logs a failed retraction too', async () => {
      notificationsRepository.deleteMatching.mockRejectedValue(
        prismaError('P1001'),
      );

      await expect(
        listener.onLikeRemoved({
          actorId: ACTOR_ID,
          recipientId: RECIPIENT_ID,
          postId: 'post-1',
        }),
      ).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('treats a P2003 (post / comment / user deleted meanwhile) as a silent no-op', async () => {
      notificationsRepository.create.mockRejectedValue(prismaError('P2003'));

      await expect(
        listener.onCommentCreated({
          actorId: ACTOR_ID,
          recipientId: RECIPIENT_ID,
          postId: 'post-1',
          commentId: 'comment-1',
        }),
      ).resolves.toBeUndefined();
      expect(logError).not.toHaveBeenCalled();
    });
  });

  it('declares every handler async, for its own event', () => {
    const handlers = [
      ['onLikeCreated', DomainEvent.LikeCreated],
      ['onLikeRemoved', DomainEvent.LikeRemoved],
      ['onFollowCreated', DomainEvent.FollowCreated],
      ['onFollowRemoved', DomainEvent.FollowRemoved],
      ['onCommentCreated', DomainEvent.CommentCreated],
    ] as const;
    for (const [name, event] of handlers) {
      expect(
        Reflect.getMetadata(
          EVENT_LISTENER_METADATA,
          NotificationsListener.prototype[name],
        ),
      ).toEqual([{ event, options: { async: true } }]);
    }
  });

  // Wired through the real EventEmitterModule: a failing listener never
  // reaches the emitter (i.e. the originating request).
  it('is subscribed to the domain events and never throws into emit()', async () => {
    notificationsRepository.create.mockRejectedValue(new Error('db down'));
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        NotificationsListener,
        NotificationsService,
        {
          provide: NotificationsRepository,
          useValue: notificationsRepository,
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const emitter = app.get(EventEmitter2);

      expect(() =>
        emitter.emit(DomainEvent.FollowCreated, {
          actorId: ACTOR_ID,
          recipientId: RECIPIENT_ID,
        }),
      ).not.toThrow();
      await vi.waitFor(() => {
        expect(logError).toHaveBeenCalledTimes(1);
      });
      expect(notificationsRepository.create).toHaveBeenCalledWith({
        type: 'follow',
        recipientId: RECIPIENT_ID,
        actorId: ACTOR_ID,
      });
    } finally {
      await app.close();
    }
  });
});
