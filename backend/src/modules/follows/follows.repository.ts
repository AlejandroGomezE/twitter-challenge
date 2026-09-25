import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CursorPosition } from '../posts/pagination.js';

// Columns a follow-list row needs from the other user. Deliberately no email
// (the id is only used internally, for the relation lookups and the cursor).
const FOLLOW_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
} satisfies Prisma.UserSelect;

export type FollowUserRow = Prisma.UserGetPayload<{
  select: typeof FOLLOW_USER_SELECT;
}>;

// One row of a followers/following list: the other user plus when the follow
// was created (the list's sort key).
export interface FollowEdge {
  user: FollowUserRow;
  createdAt: Date;
}

export interface FindFollowPageParams {
  // The user whose followers / following are listed.
  userId: string;
  // Position (follow createdAt, other user's id) of the last row of the
  // previous page; omitted for the first.
  cursor?: CursorPosition;
  limit: number;
}

// Prisma's code for a unique/primary-key violation.
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Data access for follows (and the minimal user lookups the follows module
// needs, so it never depends on the users module).
@Injectable()
export class FollowsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // `username` must already be normalized (usernames are stored lowercase).
  findUserIdByUsername(username: string): Promise<{ id: string } | null> {
    return this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
  }

  // Idempotent insert-or-ignore of the (followerId, followingId) follow, the
  // same race-safe pattern as PostsRepository.like: the composite primary key
  // is the only arbiter, so of N concurrent identical requests one inserts
  // and the rest hit P2002 and are treated as "already following". Any other
  // error — e.g. P2003 when a user was deleted meanwhile — is rethrown for
  // the service to map.
  async follow(followerId: string, followingId: string): Promise<void> {
    try {
      await this.prisma.follow.create({
        data: { followerId, followingId },
        select: { followerId: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return;
      }
      throw error;
    }
  }

  // Idempotent: removing a follow that doesn't exist deletes nothing.
  async unfollow(followerId: string, followingId: string): Promise<void> {
    await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
  }

  followerCount(userId: string): Promise<number> {
    return this.prisma.follow.count({ where: { followingId: userId } });
  }

  followingCount(userId: string): Promise<number> {
    return this.prisma.follow.count({ where: { followerId: userId } });
  }

  // Ids of every user `userId` follows.
  async followedIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    return rows.map((row) => row.followingId);
  }

  // Users following `userId`, most recent follow first (createdAt DESC,
  // follower id DESC), strictly after `cursor`. Returns up to `limit + 1`
  // rows: the extra row only tells the caller that a next page exists.
  async findFollowersPage(params: FindFollowPageParams): Promise<FollowEdge[]> {
    const { userId, cursor, limit } = params;
    const where: Prisma.FollowWhereInput = { followingId: userId };
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, followerId: { lt: cursor.id } },
      ];
    }
    const rows = await this.prisma.follow.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
      take: limit + 1,
      select: { createdAt: true, follower: { select: FOLLOW_USER_SELECT } },
    });
    return rows.map((row) => ({
      user: row.follower,
      createdAt: row.createdAt,
    }));
  }

  // Users `userId` follows, most recent follow first (createdAt DESC,
  // followed user's id DESC); same paging contract as findFollowersPage.
  async findFollowingPage(params: FindFollowPageParams): Promise<FollowEdge[]> {
    const { userId, cursor, limit } = params;
    const where: Prisma.FollowWhereInput = { followerId: userId };
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, followingId: { lt: cursor.id } },
      ];
    }
    const rows = await this.prisma.follow.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { followingId: 'desc' }],
      take: limit + 1,
      select: { createdAt: true, following: { select: FOLLOW_USER_SELECT } },
    });
    return rows.map((row) => ({
      user: row.following,
      createdAt: row.createdAt,
    }));
  }

  // Of `userIds`, the ones `viewerId` follows and the ones following
  // `viewerId` — two queries however many ids are asked for (no N+1).
  async relationsAmong(
    viewerId: string,
    userIds: string[],
  ): Promise<{ followedByViewer: Set<string>; followingViewer: Set<string> }> {
    if (userIds.length === 0) {
      return { followedByViewer: new Set(), followingViewer: new Set() };
    }
    const [followed, following] = await Promise.all([
      this.prisma.follow.findMany({
        where: { followerId: viewerId, followingId: { in: userIds } },
        select: { followingId: true },
      }),
      this.prisma.follow.findMany({
        where: { followingId: viewerId, followerId: { in: userIds } },
        select: { followerId: true },
      }),
    ]);
    return {
      followedByViewer: new Set(followed.map((row) => row.followingId)),
      followingViewer: new Set(following.map((row) => row.followerId)),
    };
  }

  // Up to `limit` users `viewerId` doesn't follow, excluding `viewerId`,
  // newest accounts first (createdAt DESC, id DESC).
  findSuggestions(viewerId: string, limit: number): Promise<FollowUserRow[]> {
    return this.prisma.user.findMany({
      where: {
        id: { not: viewerId },
        followers: { none: { followerId: viewerId } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: FOLLOW_USER_SELECT,
    });
  }
}
