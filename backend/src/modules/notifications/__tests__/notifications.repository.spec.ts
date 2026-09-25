import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import { NotificationsRepository } from '../notifications.repository.js';

const RECIPIENT_ID = 'user-recipient';
const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  createdAt: true,
  readAt: true,
  actor: { select: { username: true, displayName: true } },
  post: { select: { id: true, body: true } },
  comment: { select: { id: true, body: true } },
};

// Checks the query shape handed to Prisma (mocked — no database).
describe('NotificationsRepository', () => {
  let repository: NotificationsRepository;

  const prisma = {
    notification: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    prisma.notification.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = moduleRef.get(NotificationsRepository);
  });

  it('create inserts the row as given', async () => {
    const data = {
      type: 'comment',
      recipientId: RECIPIENT_ID,
      actorId: 'user-actor',
      postId: 'post-1',
      commentId: 'comment-1',
    };

    await repository.create(data);

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data,
      select: { id: true },
    });
  });

  it('create rethrows errors (e.g. P2003) to the caller', async () => {
    const error = new Error('P2003');
    prisma.notification.create.mockRejectedValue(error);

    await expect(
      repository.create({
        type: 'follow',
        recipientId: RECIPIENT_ID,
        actorId: 'user-actor',
      }),
    ).rejects.toBe(error);
  });

  it('deleteMatching deletes by type, recipient, actor and post and returns the count', async () => {
    const match = {
      type: 'like',
      recipientId: RECIPIENT_ID,
      actorId: 'user-actor',
      postId: 'post-1',
    };
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });

    await expect(repository.deleteMatching(match)).resolves.toBe(1);

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: match,
    });
  });

  describe('findPage', () => {
    it('reads the recipient’s newest first (createdAt, id), limit + 1, with actor / post / comment', async () => {
      await repository.findPage({ recipientId: RECIPIENT_ID, limit: 20 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { recipientId: RECIPIENT_ID },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: NOTIFICATION_SELECT,
      });
    });

    it('reads strictly after the cursor, still scoped to the recipient', async () => {
      const createdAt = new Date('2026-09-24T10:00:00.000Z');

      await repository.findPage({
        recipientId: RECIPIENT_ID,
        cursor: { createdAt, id: 'n-5' },
        limit: 5,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            recipientId: RECIPIENT_ID,
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, id: { lt: 'n-5' } },
            ],
          },
          take: 6,
        }),
      );
    });
  });

  it('countUnread counts the recipient’s rows with no readAt', async () => {
    prisma.notification.count.mockResolvedValue(3);

    await expect(repository.countUnread(RECIPIENT_ID)).resolves.toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { recipientId: RECIPIENT_ID, readAt: null },
    });
  });

  it('markReadUntil updates only the recipient’s unread rows up to `until` and returns the count', async () => {
    const until = new Date('2026-09-24T10:00:00.000Z');
    const readAt = new Date('2026-09-24T12:00:00.000Z');
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });

    await expect(
      repository.markReadUntil(RECIPIENT_ID, until, readAt),
    ).resolves.toBe(3);

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        recipientId: RECIPIENT_ID,
        readAt: null,
        createdAt: { lte: until },
      },
      data: { readAt },
    });
  });
});
