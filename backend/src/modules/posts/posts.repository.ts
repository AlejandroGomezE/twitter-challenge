import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CursorPosition } from './pagination.js';

// Columns every post read needs: the post itself plus its author's username.
const POST_WITH_AUTHOR_SELECT = {
  id: true,
  authorId: true,
  body: true,
  createdAt: true,
  author: { select: { username: true } },
} satisfies Prisma.PostSelect;

export type PostWithAuthor = Prisma.PostGetPayload<{
  select: typeof POST_WITH_AUTHOR_SELECT;
}>;

export interface CreatePostData {
  authorId: string;
  body: string;
}

export interface FindPageParams {
  authorIds: string[];
  // Position of the last post of the previous page; omitted for the first.
  cursor?: CursorPosition;
  limit: number;
}

// Prisma's code for a unique/primary-key violation.
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export interface PostCounts {
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

// Data access for posts (and, for counts, their likes and comments).
@Injectable()
export class PostsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreatePostData): Promise<PostWithAuthor> {
    return this.prisma.post.create({
      data: { authorId: data.authorId, body: data.body },
      select: POST_WITH_AUTHOR_SELECT,
    });
  }

  findById(id: string): Promise<PostWithAuthor | null> {
    return this.prisma.post.findUnique({
      where: { id },
      select: POST_WITH_AUTHOR_SELECT,
    });
  }

  // Posts by any of `authorIds`, newest first (`createdAt DESC, id DESC`),
  // strictly after `cursor` in that order. Returns up to `limit + 1` rows:
  // the extra row only tells the caller that a next page exists.
  findPage(params: FindPageParams): Promise<PostWithAuthor[]> {
    const { authorIds, cursor, limit } = params;
    const where: Prisma.PostWhereInput = { authorId: { in: authorIds } };
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }
    return this.prisma.post.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: POST_WITH_AUTHOR_SELECT,
    });
  }

  countByAuthor(authorId: string): Promise<number> {
    return this.prisma.post.count({ where: { authorId } });
  }

  // Deletes the post only if `authorId` wrote it; returns the number of rows
  // deleted (0 or 1). Its likes and comments go with it (onDelete: Cascade).
  async deleteByIdAndAuthor(id: string, authorId: string): Promise<number> {
    const { count } = await this.prisma.post.deleteMany({
      where: { id, authorId },
    });
    return count;
  }

  // Idempotent insert-or-ignore of the (userId, postId) like. A plain create
  // with P2002 swallowed is race-safe: the composite primary key is the only
  // arbiter, so of N concurrent identical requests one inserts and the rest
  // hit the key and are treated as "already liked". (Prisma's `upsert` is
  // not relied on here: unless it qualifies for a native database upsert it
  // runs as read-then-create, which can itself throw P2002 under a race.)
  // Any other error — e.g. P2003 when the post was deleted meanwhile — is
  // rethrown for the service to map.
  async like(userId: string, postId: string): Promise<void> {
    try {
      await this.prisma.like.create({
        data: { userId, postId },
        select: { postId: true },
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

  // Idempotent: removing a like that doesn't exist deletes nothing.
  async unlike(userId: string, postId: string): Promise<void> {
    await this.prisma.like.deleteMany({ where: { userId, postId } });
  }

  likeCount(postId: string): Promise<number> {
    return this.prisma.like.count({ where: { postId } });
  }

  // Like/comment counts and the viewer's like state for many posts in three
  // queries regardless of how many posts are asked for (no N+1). Posts with
  // no likes/comments get zeros; every requested id has an entry.
  async countsFor(
    postIds: string[],
    viewerId: string,
  ): Promise<Map<string, PostCounts>> {
    const counts = new Map<string, PostCounts>(
      postIds.map((id) => [
        id,
        { likeCount: 0, commentCount: 0, likedByMe: false },
      ]),
    );
    if (postIds.length === 0) {
      return counts;
    }
    const [likeGroups, commentGroups, viewerLikes] = await Promise.all([
      this.prisma.like.groupBy({
        by: ['postId'],
        where: { postId: { in: postIds } },
        _count: { _all: true },
      }),
      this.prisma.comment.groupBy({
        by: ['postId'],
        where: { postId: { in: postIds } },
        _count: { _all: true },
      }),
      this.prisma.like.findMany({
        where: { userId: viewerId, postId: { in: postIds } },
        select: { postId: true },
      }),
    ]);
    for (const group of likeGroups) {
      const entry = counts.get(group.postId);
      if (entry) {
        entry.likeCount = group._count._all;
      }
    }
    for (const group of commentGroups) {
      const entry = counts.get(group.postId);
      if (entry) {
        entry.commentCount = group._count._all;
      }
    }
    for (const like of viewerLikes) {
      const entry = counts.get(like.postId);
      if (entry) {
        entry.likedByMe = true;
      }
    }
    return counts;
  }
}
