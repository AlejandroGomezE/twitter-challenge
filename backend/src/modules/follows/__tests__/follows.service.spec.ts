import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../generated/prisma/client.js';
import { decodeCursor, encodeCursor } from '../../posts/pagination.js';
import {
  type FollowEdge,
  FollowsRepository,
  type FollowUserRow,
} from '../follows.repository.js';
import { FollowsService } from '../follows.service.js';

const VIEWER_ID = 'user-viewer';
const TARGET_ID = 'user-target';
const CREATED_AT = new Date('2026-09-24T10:00:00.000Z');

function user(id: string): FollowUserRow {
  return { id, username: `name_${id}`, bio: `bio of ${id}` };
}

// `count` edges sharing one timestamp, ids descending like the repository's
// ordering.
function edges(count: number): FollowEdge[] {
  return Array.from({ length: count }, (_, index) => ({
    user: user(`u-${String(count - index).padStart(3, '0')}`),
    createdAt: CREATED_AT,
  }));
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
    code,
    clientVersion: 'test',
  });
}

const NO_RELATIONS = {
  followedByViewer: new Set<string>(),
  followingViewer: new Set<string>(),
};

describe('FollowsService', () => {
  let service: FollowsService;

  const followsRepository = {
    findUserIdByUsername: vi.fn(),
    follow: vi.fn(),
    unfollow: vi.fn(),
    followerCount: vi.fn(),
    followingCount: vi.fn(),
    followedIds: vi.fn(),
    findFollowersPage: vi.fn(),
    findFollowingPage: vi.fn(),
    relationsAmong: vi.fn(),
    findSuggestions: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    followsRepository.relationsAmong.mockResolvedValue(NO_RELATIONS);
    const moduleRef = await Test.createTestingModule({
      providers: [
        FollowsService,
        { provide: FollowsRepository, useValue: followsRepository },
      ],
    }).compile();
    service = moduleRef.get(FollowsService);
  });

  describe('setFollowing', () => {
    beforeEach(() => {
      followsRepository.findUserIdByUsername.mockResolvedValue({
        id: TARGET_ID,
      });
      followsRepository.followerCount.mockResolvedValue(4);
    });

    it('follows the normalized username and returns the new follower count', async () => {
      await expect(
        service.setFollowing(VIEWER_ID, '  Target_User ', true),
      ).resolves.toEqual({ following: true, followerCount: 4 });

      expect(followsRepository.findUserIdByUsername).toHaveBeenCalledWith(
        'target_user',
      );
      expect(followsRepository.follow).toHaveBeenCalledWith(
        VIEWER_ID,
        TARGET_ID,
      );
      expect(followsRepository.unfollow).not.toHaveBeenCalled();
      expect(followsRepository.followerCount).toHaveBeenCalledWith(TARGET_ID);
    });

    it('unfollows and returns following=false with the count', async () => {
      await expect(
        service.setFollowing(VIEWER_ID, 'target', false),
      ).resolves.toEqual({ following: false, followerCount: 4 });

      expect(followsRepository.unfollow).toHaveBeenCalledWith(
        VIEWER_ID,
        TARGET_ID,
      );
      expect(followsRepository.follow).not.toHaveBeenCalled();
    });

    it('404s an unknown username without writing', async () => {
      followsRepository.findUserIdByUsername.mockResolvedValue(null);

      await expect(
        service.setFollowing(VIEWER_ID, 'ghost', true),
      ).rejects.toEqual(new NotFoundException('User not found'));
      expect(followsRepository.follow).not.toHaveBeenCalled();
    });

    it.each([
      [true, 'You cannot follow yourself'],
      [false, 'You cannot unfollow yourself'],
    ])('400s on yourself (following=%s)', async (following, message) => {
      followsRepository.findUserIdByUsername.mockResolvedValue({
        id: VIEWER_ID,
      });

      await expect(
        service.setFollowing(VIEWER_ID, 'me_myself', following),
      ).rejects.toEqual(new BadRequestException(message));
      expect(followsRepository.follow).not.toHaveBeenCalled();
      expect(followsRepository.unfollow).not.toHaveBeenCalled();
    });

    it('maps a P2003 (user deleted meanwhile) to 404', async () => {
      followsRepository.follow.mockRejectedValue(prismaError('P2003'));

      await expect(
        service.setFollowing(VIEWER_ID, 'target', true),
      ).rejects.toEqual(new NotFoundException('User not found'));
    });

    it('rethrows other errors', async () => {
      const failure = new Error('db down');
      followsRepository.follow.mockRejectedValue(failure);

      await expect(
        service.setFollowing(VIEWER_ID, 'target', true),
      ).rejects.toBe(failure);
    });
  });

  describe.each([
    ['listFollowers', 'findFollowersPage'],
    ['listFollowing', 'findFollowingPage'],
  ] as const)('%s', (method, reader) => {
    beforeEach(() => {
      followsRepository.findUserIdByUsername.mockResolvedValue({
        id: TARGET_ID,
      });
    });

    it('reads the first page (default size 20) of the resolved user', async () => {
      followsRepository[reader].mockResolvedValue(edges(3));

      const page = await service[method]('Target', VIEWER_ID, {});

      expect(followsRepository.findUserIdByUsername).toHaveBeenCalledWith(
        'target',
      );
      expect(followsRepository[reader]).toHaveBeenCalledWith({
        userId: TARGET_ID,
        cursor: undefined,
        limit: 20,
      });
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((item) => item.username)).toEqual([
        'name_u-003',
        'name_u-002',
        'name_u-001',
      ]);
    });

    it('returns a cursor at the last kept row when limit + 1 rows come back', async () => {
      followsRepository[reader].mockResolvedValue(edges(3));

      const page = await service[method]('target', VIEWER_ID, { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
      expect(decodeCursor(page.nextCursor as string)).toEqual({
        createdAt: CREATED_AT,
        id: 'u-002',
      });
    });

    it('passes a decoded cursor through', async () => {
      followsRepository[reader].mockResolvedValue([]);
      const cursor = encodeCursor({ createdAt: CREATED_AT, id: 'u-009' });

      await service[method]('target', VIEWER_ID, { cursor, limit: 5 });

      expect(followsRepository[reader]).toHaveBeenCalledWith({
        userId: TARGET_ID,
        cursor: { createdAt: CREATED_AT, id: 'u-009' },
        limit: 5,
      });
    });

    it('400s an invalid cursor before any query', async () => {
      await expect(
        service[method]('target', VIEWER_ID, { cursor: 'not a cursor' }),
      ).rejects.toEqual(new BadRequestException('Invalid cursor'));
      expect(followsRepository.findUserIdByUsername).not.toHaveBeenCalled();
      expect(followsRepository[reader]).not.toHaveBeenCalled();
    });

    it('404s an unknown user', async () => {
      followsRepository.findUserIdByUsername.mockResolvedValue(null);

      await expect(service[method]('ghost', VIEWER_ID, {})).rejects.toEqual(
        new NotFoundException('User not found'),
      );
      expect(followsRepository[reader]).not.toHaveBeenCalled();
    });

    it('computes the booleans for the whole page in one relation lookup, false on the viewer row', async () => {
      followsRepository[reader].mockResolvedValue([
        { user: user('a'), createdAt: CREATED_AT },
        { user: user(VIEWER_ID), createdAt: CREATED_AT },
        { user: user('b'), createdAt: CREATED_AT },
      ]);
      followsRepository.relationsAmong.mockResolvedValue({
        followedByViewer: new Set(['a']),
        followingViewer: new Set(['a', 'b']),
      });

      const page = await service[method]('target', VIEWER_ID, {});

      expect(followsRepository.relationsAmong).toHaveBeenCalledTimes(1);
      expect(followsRepository.relationsAmong).toHaveBeenCalledWith(VIEWER_ID, [
        'a',
        'b',
      ]);
      expect(page.items).toEqual([
        {
          username: 'name_a',
          bio: 'bio of a',
          isFollowing: true,
          followsYou: true,
        },
        {
          username: `name_${VIEWER_ID}`,
          bio: `bio of ${VIEWER_ID}`,
          isFollowing: false,
          followsYou: false,
        },
        {
          username: 'name_b',
          bio: 'bio of b',
          isFollowing: false,
          followsYou: true,
        },
      ]);
    });
  });

  describe('suggestions', () => {
    it('defaults to 3 and marks users following the viewer', async () => {
      followsRepository.findSuggestions.mockResolvedValue([
        user('a'),
        user('b'),
      ]);
      followsRepository.relationsAmong.mockResolvedValue({
        followedByViewer: new Set(),
        followingViewer: new Set(['b']),
      });

      const list = await service.suggestions(VIEWER_ID);

      expect(followsRepository.findSuggestions).toHaveBeenCalledWith(
        VIEWER_ID,
        3,
      );
      expect(list).toEqual({
        items: [
          {
            username: 'name_a',
            bio: 'bio of a',
            isFollowing: false,
            followsYou: false,
          },
          {
            username: 'name_b',
            bio: 'bio of b',
            isFollowing: false,
            followsYou: true,
          },
        ],
      });
    });

    it('passes an explicit limit', async () => {
      followsRepository.findSuggestions.mockResolvedValue([]);

      await expect(service.suggestions(VIEWER_ID, 10)).resolves.toEqual({
        items: [],
      });
      expect(followsRepository.findSuggestions).toHaveBeenCalledWith(
        VIEWER_ID,
        10,
      );
    });
  });

  describe('exports for other modules', () => {
    it('followedIds delegates to the repository', async () => {
      followsRepository.followedIds.mockResolvedValue(['a', 'b']);

      await expect(service.followedIds(VIEWER_ID)).resolves.toEqual(['a', 'b']);
      expect(followsRepository.followedIds).toHaveBeenCalledWith(VIEWER_ID);
    });

    it('counts returns both totals', async () => {
      followsRepository.followerCount.mockResolvedValue(2);
      followsRepository.followingCount.mockResolvedValue(5);

      await expect(service.counts(TARGET_ID)).resolves.toEqual({
        followerCount: 2,
        followingCount: 5,
      });
      expect(followsRepository.followerCount).toHaveBeenCalledWith(TARGET_ID);
      expect(followsRepository.followingCount).toHaveBeenCalledWith(TARGET_ID);
    });

    it('relation reads both directions for the target', async () => {
      followsRepository.relationsAmong.mockResolvedValue({
        followedByViewer: new Set([TARGET_ID]),
        followingViewer: new Set(),
      });

      await expect(service.relation(VIEWER_ID, TARGET_ID)).resolves.toEqual({
        isFollowing: true,
        followsYou: false,
      });
      expect(followsRepository.relationsAmong).toHaveBeenCalledWith(VIEWER_ID, [
        TARGET_ID,
      ]);
    });

    it('relation is all false on yourself, without a query', async () => {
      await expect(service.relation(VIEWER_ID, VIEWER_ID)).resolves.toEqual({
        isFollowing: false,
        followsYou: false,
      });
      expect(followsRepository.relationsAmong).not.toHaveBeenCalled();
    });
  });
});
