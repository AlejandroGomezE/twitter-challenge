import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DomainEvent,
  emitDomainEvent,
} from '../../common/events/domain-events.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CommentsRepository,
  type CommentWithAuthor,
} from './comments.repository.js';
import { decodeCursor, encodeCursor, resolvePageSize } from './pagination.js';
import { PostsRepository, type PostWithAuthor } from './posts.repository.js';
import { normalizeBody } from './posts.rules.js';
import type { PageQuery } from './posts.service.js';

// A comment as any signed-in viewer sees it.
export interface CommentView {
  id: string;
  body: string;
  createdAt: Date;
  author: { username: string; displayName: string | null };
}

// One page of a post's comments, oldest first. `nextCursor` is null on the
// last page.
export interface CommentPage {
  items: CommentView[];
  nextCursor: string | null;
}

const POST_NOT_FOUND_MESSAGE = 'Post not found';
const COMMENT_NOT_FOUND_MESSAGE = 'Comment not found';
const NOT_COMMENT_AUTHOR_MESSAGE = 'You can only delete your own comments';
// Prisma's code for a foreign-key violation.
const FOREIGN_KEY_VIOLATION = 'P2003';

@Injectable()
export class CommentsService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly postsRepository: PostsRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Keyset page over (createdAt, id), oldest first. An invalid cursor is a
  // 400 `Invalid cursor` (checked before any query runs); 404 if the post
  // doesn't exist.
  async list(postId: string, query: PageQuery): Promise<CommentPage> {
    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const limit = resolvePageSize(query.limit);
    await this.assertPostExists(postId);
    const rows = await this.commentsRepository.findPage({
      postId,
      cursor,
      limit,
    });
    const comments = rows.slice(0, limit);
    const last = comments.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return {
      items: comments.map((comment) => this.toView(comment)),
      nextCursor,
    };
  }

  // `authorId` is always the session user's id. 404 if the post doesn't
  // exist: checked first, and again via the FK violation (P2003) if the post
  // is deleted between the check and the insert, so that race is a 404.
  // Emits `comment.created` once the comment is stored.
  async create(
    postId: string,
    authorId: string,
    body: string,
  ): Promise<CommentView> {
    const post = await this.findPostOrThrow(postId);
    let comment: CommentWithAuthor;
    try {
      comment = await this.commentsRepository.create({
        postId,
        authorId,
        body: normalizeBody(body),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new NotFoundException(POST_NOT_FOUND_MESSAGE);
      }
      throw error;
    }
    emitDomainEvent(this.eventEmitter, DomainEvent.CommentCreated, {
      actorId: authorId,
      recipientId: post.authorId,
      postId,
      commentId: comment.id,
    });
    return this.toView(comment);
  }

  // 404 if the comment is missing or belongs to another post; 403 if it is
  // someone else's. The delete itself is scoped to the author, so a
  // concurrent delete surfaces as a 404. Emits `comment.removed` only after a
  // successful delete.
  async delete(
    postId: string,
    commentId: string,
    userId: string,
  ): Promise<void> {
    const comment = await this.commentsRepository.findById(commentId);
    if (!comment || comment.postId !== postId) {
      throw new NotFoundException(COMMENT_NOT_FOUND_MESSAGE);
    }
    if (comment.authorId !== userId) {
      throw new ForbiddenException(NOT_COMMENT_AUTHOR_MESSAGE);
    }
    const deleted = await this.commentsRepository.deleteByIdAndAuthor(
      commentId,
      userId,
    );
    if (deleted === 0) {
      throw new NotFoundException(COMMENT_NOT_FOUND_MESSAGE);
    }
    emitDomainEvent(this.eventEmitter, DomainEvent.CommentRemoved, {
      actorId: userId,
      postId,
      commentId,
    });
  }

  private async assertPostExists(postId: string): Promise<void> {
    await this.findPostOrThrow(postId);
  }

  private async findPostOrThrow(postId: string): Promise<PostWithAuthor> {
    const post = await this.postsRepository.findById(postId);
    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND_MESSAGE);
    }
    return post;
  }

  private toView(comment: CommentWithAuthor): CommentView {
    return {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      author: {
        username: comment.author.username,
        displayName: comment.author.displayName,
      },
    };
  }
}
