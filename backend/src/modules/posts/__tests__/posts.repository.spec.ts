import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PostsRepository } from '../posts.repository.js';

// Checks the query shape handed to Prisma (mocked — no database). The real
// keyset behaviour over equal timestamps is exercised end-to-end.
describe('PostsRepository', () => {
  let repository: PostsRepository;

  const prisma = {
    post: { findMany: vi.fn(), count: vi.fn() },
    like: { create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  };

  function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
      code,
      clientVersion: 'test',
    });
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    prisma.post.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PostsRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = moduleRef.get(PostsRepository);
  });

  describe('findPage', () => {
    it('reads the first page newest first (createdAt, id), fetching limit + 1', async () => {
      await repository.findPage({ authorIds: ['user-1'], limit: 20 });

      expect(prisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { authorId: { in: ['user-1'] } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
        }),
      );
    });

    it('continues strictly after the cursor: older, or same time with a smaller id', async () => {
      const createdAt = new Date('2026-09-24T10:00:00.000Z');

      await repository.findPage({
        authorIds: ['user-1', 'user-2'],
        cursor: { createdAt, id: 'post-9' },
        limit: 5,
      });

      expect(prisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            authorId: { in: ['user-1', 'user-2'] },
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, id: { lt: 'post-9' } },
            ],
          },
          take: 6,
        }),
      );
    });

    it('has no author filter when authorIds is omitted (every author)', async () => {
      const createdAt = new Date('2026-09-24T10:00:00.000Z');

      await repository.findPage({ limit: 10 });
      await repository.findPage({
        cursor: { createdAt, id: 'post-9' },
        limit: 10,
      });

      expect(prisma.post.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {},
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 11,
        }),
      );
      expect(prisma.post.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, id: { lt: 'post-9' } },
            ],
          },
        }),
      );
    });

    it("selects the author's username and display name only (never the whole user row)", async () => {
      await repository.findPage({ authorIds: ['user-1'], limit: 1 });

      const [args] = prisma.post.findMany.mock.calls[0] as [
        { select: Record<string, unknown> },
      ];
      expect(args.select.author).toEqual({
        select: { username: true, displayName: true },
      });
    });
  });

  describe('countByAuthor', () => {
    it("counts the author's posts in one query", async () => {
      prisma.post.count.mockResolvedValue(3);

      await expect(repository.countByAuthor('user-1')).resolves.toBe(3);
      expect(prisma.post.count).toHaveBeenCalledWith({
        where: { authorId: 'user-1' },
      });
    });
  });

  describe('like', () => {
    it('inserts the (userId, postId) like and resolves true', async () => {
      prisma.like.create.mockResolvedValue({ postId: 'post-1' });

      await expect(repository.like('user-1', 'post-1')).resolves.toBe(true);
      expect(prisma.like.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { userId: 'user-1', postId: 'post-1' },
        }),
      );
    });

    it('ignores a duplicate (P2002): already liked resolves false', async () => {
      prisma.like.create.mockRejectedValue(prismaError('P2002'));

      await expect(repository.like('user-1', 'post-1')).resolves.toBe(false);
    });

    it('rethrows any other error (e.g. P2003 for a deleted post)', async () => {
      const error = prismaError('P2003');
      prisma.like.create.mockRejectedValue(error);

      await expect(repository.like('user-1', 'post-1')).rejects.toBe(error);
    });
  });

  describe('unlike', () => {
    it("deletes only that user's like on that post (0 rows is fine)", async () => {
      prisma.like.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.unlike('user-1', 'post-1'),
      ).resolves.toBeUndefined();
      expect(prisma.like.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', postId: 'post-1' },
      });
    });
  });

  describe('likeCount', () => {
    it("counts the post's likes", async () => {
      prisma.like.count.mockResolvedValue(2);

      await expect(repository.likeCount('post-1')).resolves.toBe(2);
      expect(prisma.like.count).toHaveBeenCalledWith({
        where: { postId: 'post-1' },
      });
    });
  });
});
