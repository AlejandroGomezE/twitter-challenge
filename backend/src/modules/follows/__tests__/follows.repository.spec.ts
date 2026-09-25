import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { FollowsRepository } from '../follows.repository.js';

// Checks the query shape handed to Prisma (mocked — no database). The real
// keyset and suggestion behaviour is exercised end-to-end.
describe('FollowsRepository', () => {
  let repository: FollowsRepository;

  const prisma = {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    follow: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };

  function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
      code,
      clientVersion: 'test',
    });
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        FollowsRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = moduleRef.get(FollowsRepository);
  });

  it('findUserIdByUsername selects only the id', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1' });

    await expect(repository.findUserIdByUsername('alice')).resolves.toEqual({
      id: 'u-1',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'alice' },
      select: { id: true },
    });
  });

  describe('follow', () => {
    it('creates the (follower, following) row', async () => {
      await repository.follow('a', 'b');

      expect(prisma.follow.create).toHaveBeenCalledWith({
        data: { followerId: 'a', followingId: 'b' },
        select: { followerId: true },
      });
    });

    it('treats a P2002 (already following) as success', async () => {
      prisma.follow.create.mockRejectedValue(prismaError('P2002'));

      await expect(repository.follow('a', 'b')).resolves.toBeUndefined();
    });

    it('rethrows other errors (e.g. P2003)', async () => {
      const error = prismaError('P2003');
      prisma.follow.create.mockRejectedValue(error);

      await expect(repository.follow('a', 'b')).rejects.toBe(error);
    });
  });

  it('unfollow deletes by both ids (a no-op when absent)', async () => {
    prisma.follow.deleteMany.mockResolvedValue({ count: 0 });

    await repository.unfollow('a', 'b');

    expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
      where: { followerId: 'a', followingId: 'b' },
    });
  });

  it('counts followers and following by the right column', async () => {
    prisma.follow.count.mockResolvedValue(3);

    await repository.followerCount('u-1');
    await repository.followingCount('u-1');

    expect(prisma.follow.count).toHaveBeenNthCalledWith(1, {
      where: { followingId: 'u-1' },
    });
    expect(prisma.follow.count).toHaveBeenNthCalledWith(2, {
      where: { followerId: 'u-1' },
    });
  });

  it('followedIds maps the followed ids', async () => {
    prisma.follow.findMany.mockResolvedValue([
      { followingId: 'b' },
      { followingId: 'c' },
    ]);

    await expect(repository.followedIds('a')).resolves.toEqual(['b', 'c']);
    expect(prisma.follow.findMany).toHaveBeenCalledWith({
      where: { followerId: 'a' },
      select: { followingId: true },
    });
  });

  describe('findFollowersPage', () => {
    it('reads newest follow first (createdAt, follower id), limit + 1, without email', async () => {
      const createdAt = new Date('2026-09-24T10:00:00.000Z');
      prisma.follow.findMany.mockResolvedValue([
        { createdAt, follower: { id: 'f', username: 'f_user', bio: null } },
      ]);

      await expect(
        repository.findFollowersPage({ userId: 'u-1', limit: 20 }),
      ).resolves.toEqual([
        { createdAt, user: { id: 'f', username: 'f_user', bio: null } },
      ]);
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { followingId: 'u-1' },
        orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
        take: 21,
        select: {
          createdAt: true,
          follower: { select: { id: true, username: true, bio: true } },
        },
      });
    });

    it('continues strictly after the cursor', async () => {
      const createdAt = new Date('2026-09-24T10:00:00.000Z');

      await repository.findFollowersPage({
        userId: 'u-1',
        cursor: { createdAt, id: 'f-9' },
        limit: 5,
      });

      expect(prisma.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            followingId: 'u-1',
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, followerId: { lt: 'f-9' } },
            ],
          },
          take: 6,
        }),
      );
    });
  });

  describe('findFollowingPage', () => {
    it('reads newest follow first (createdAt, followed id) after the cursor', async () => {
      const createdAt = new Date('2026-09-24T10:00:00.000Z');
      prisma.follow.findMany.mockResolvedValue([
        { createdAt, following: { id: 'g', username: 'g_user', bio: 'hi' } },
      ]);

      await expect(
        repository.findFollowingPage({
          userId: 'u-1',
          cursor: { createdAt, id: 'g-9' },
          limit: 2,
        }),
      ).resolves.toEqual([
        { createdAt, user: { id: 'g', username: 'g_user', bio: 'hi' } },
      ]);
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: {
          followerId: 'u-1',
          OR: [
            { createdAt: { lt: createdAt } },
            { createdAt, followingId: { lt: 'g-9' } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { followingId: 'desc' }],
        take: 3,
        select: {
          createdAt: true,
          following: { select: { id: true, username: true, bio: true } },
        },
      });
    });
  });

  describe('relationsAmong', () => {
    it('runs no query for no ids', async () => {
      const relations = await repository.relationsAmong('v', []);

      expect(relations.followedByViewer.size).toBe(0);
      expect(relations.followingViewer.size).toBe(0);
      expect(prisma.follow.findMany).not.toHaveBeenCalled();
    });

    it('runs exactly two queries for any number of ids', async () => {
      prisma.follow.findMany
        .mockResolvedValueOnce([{ followingId: 'a' }])
        .mockResolvedValueOnce([{ followerId: 'a' }, { followerId: 'b' }]);

      const relations = await repository.relationsAmong('v', ['a', 'b', 'c']);

      expect(prisma.follow.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.follow.findMany).toHaveBeenNthCalledWith(1, {
        where: { followerId: 'v', followingId: { in: ['a', 'b', 'c'] } },
        select: { followingId: true },
      });
      expect(prisma.follow.findMany).toHaveBeenNthCalledWith(2, {
        where: { followingId: 'v', followerId: { in: ['a', 'b', 'c'] } },
        select: { followerId: true },
      });
      expect([...relations.followedByViewer]).toEqual(['a']);
      expect([...relations.followingViewer]).toEqual(['a', 'b']);
    });
  });

  it('findSuggestions excludes the viewer and followed users, newest accounts first', async () => {
    await repository.findSuggestions('v', 3);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { not: 'v' },
        followers: { none: { followerId: 'v' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: { id: true, username: true, bio: true },
    });
  });
});
