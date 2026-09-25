import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CursorPosition } from './pagination.js';

// Columns every comment read needs: the comment plus its author's username
// and display name (fetched in the same query, never one lookup per row).
const COMMENT_WITH_AUTHOR_SELECT = {
  id: true,
  postId: true,
  authorId: true,
  body: true,
  createdAt: true,
  author: { select: { username: true, displayName: true } },
} satisfies Prisma.CommentSelect;

export type CommentWithAuthor = Prisma.CommentGetPayload<{
  select: typeof COMMENT_WITH_AUTHOR_SELECT;
}>;

export interface CreateCommentData {
  postId: string;
  authorId: string;
  body: string;
}

export interface FindCommentPageParams {
  postId: string;
  // Position of the last comment of the previous page; omitted for the first.
  cursor?: CursorPosition;
  limit: number;
}

// Data access for comments: the only layer touching Prisma for comments.
// Post existence is checked by the service through PostsRepository.
@Injectable()
export class CommentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Rejects with Prisma's P2003 (foreign key) if the post no longer exists.
  create(data: CreateCommentData): Promise<CommentWithAuthor> {
    return this.prisma.comment.create({
      data: { postId: data.postId, authorId: data.authorId, body: data.body },
      select: COMMENT_WITH_AUTHOR_SELECT,
    });
  }

  findById(id: string): Promise<CommentWithAuthor | null> {
    return this.prisma.comment.findUnique({
      where: { id },
      select: COMMENT_WITH_AUTHOR_SELECT,
    });
  }

  // A post's comments, oldest first (`createdAt ASC, id ASC`), strictly after
  // `cursor` in that order. Returns up to `limit + 1` rows: the extra row
  // only tells the caller that a next page exists.
  findPage(params: FindCommentPageParams): Promise<CommentWithAuthor[]> {
    const { postId, cursor, limit } = params;
    const where: Prisma.CommentWhereInput = { postId };
    if (cursor) {
      where.OR = [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ];
    }
    return this.prisma.comment.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: COMMENT_WITH_AUTHOR_SELECT,
    });
  }

  // Deletes the comment only if `authorId` wrote it; returns the number of
  // rows deleted (0 or 1).
  async deleteByIdAndAuthor(id: string, authorId: string): Promise<number> {
    const { count } = await this.prisma.comment.deleteMany({
      where: { id, authorId },
    });
    return count;
  }
}
