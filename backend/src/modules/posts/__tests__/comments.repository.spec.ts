import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import { CommentsRepository } from '../comments.repository.js';

// Checks the query shape handed to Prisma (mocked — no database). The real
// keyset behaviour over equal timestamps is exercised end-to-end.
describe('CommentsRepository', () => {
  let repository: CommentsRepository;

  const prisma = {
    comment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    prisma.comment.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = moduleRef.get(CommentsRepository);
  });

  describe('findPage', () => {
    it("reads a post's first page oldest first (createdAt, id), fetching limit + 1", async () => {
      await repository.findPage({ postId: 'post-1', limit: 20 });

      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { postId: 'post-1' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 21,
        }),
      );
    });

    it('continues strictly after the cursor: newer, or same time with a larger id', async () => {
      const createdAt = new Date('2026-09-24T10:00:00.000Z');

      await repository.findPage({
        postId: 'post-1',
        cursor: { createdAt, id: 'comment-9' },
        limit: 5,
      });

      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            postId: 'post-1',
            OR: [
              { createdAt: { gt: createdAt } },
              { createdAt, id: { gt: 'comment-9' } },
            ],
          },
          take: 6,
        }),
      );
    });

    it("selects the author's username and display name only (never the whole user row)", async () => {
      await repository.findPage({ postId: 'post-1', limit: 1 });

      const [args] = prisma.comment.findMany.mock.calls[0] as [
        { select: Record<string, unknown> },
      ];
      expect(args.select.author).toEqual({
        select: { username: true, displayName: true },
      });
    });
  });

  it('create stores the comment for the given post and author', async () => {
    prisma.comment.create.mockResolvedValue({ id: 'comment-1' });

    await repository.create({
      postId: 'post-1',
      authorId: 'user-1',
      body: 'nice',
    });

    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { postId: 'post-1', authorId: 'user-1', body: 'nice' },
      }),
    );
  });

  it('findById looks the comment up by id', async () => {
    prisma.comment.findUnique.mockResolvedValue(null);

    await expect(repository.findById('comment-1')).resolves.toBeNull();
    expect(prisma.comment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'comment-1' } }),
    );
  });

  it('deleteByIdAndAuthor deletes only when the author matches and returns the count', async () => {
    prisma.comment.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      repository.deleteByIdAndAuthor('comment-1', 'user-1'),
    ).resolves.toBe(1);
    expect(prisma.comment.deleteMany).toHaveBeenCalledWith({
      where: { id: 'comment-1', authorId: 'user-1' },
    });
  });
});
