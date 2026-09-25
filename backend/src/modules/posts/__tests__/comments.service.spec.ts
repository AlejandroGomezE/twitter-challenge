import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  CommentsRepository,
  type CommentWithAuthor,
} from '../comments.repository.js';
import { CommentsService } from '../comments.service.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { PostsRepository, type PostWithAuthor } from '../posts.repository.js';

const AUTHOR_ID = 'user-author';
const OTHER_ID = 'user-other';
const CREATED_AT = new Date('2026-09-24T10:00:00.000Z');

const POST: PostWithAuthor = {
  id: 'post-1',
  authorId: OTHER_ID,
  body: 'a post',
  createdAt: CREATED_AT,
  author: { username: 'other' },
};

const COMMENT: CommentWithAuthor = {
  id: 'comment-1',
  postId: 'post-1',
  authorId: AUTHOR_ID,
  body: 'nice',
  createdAt: CREATED_AT,
  author: { username: 'author' },
};

// `count` comments on post-1, oldest first, all sharing one timestamp so the
// id is the only tiebreaker (ids ascend like the repository's ordering).
function commentRows(count: number): CommentWithAuthor[] {
  return Array.from({ length: count }, (_, index) => ({
    ...COMMENT,
    id: `comment-${String(index + 1).padStart(3, '0')}`,
  }));
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
    code,
    clientVersion: 'test',
  });
}

describe('CommentsService', () => {
  let service: CommentsService;

  const commentsRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findPage: vi.fn(),
    deleteByIdAndAuthor: vi.fn(),
  };
  const postsRepository = { findById: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: CommentsRepository, useValue: commentsRepository },
        { provide: PostsRepository, useValue: postsRepository },
      ],
    }).compile();
    service = moduleRef.get(CommentsService);
  });

  describe('list', () => {
    it('throws 404 Post not found for an unknown post', async () => {
      postsRepository.findById.mockResolvedValue(null);

      const promise = service.list('missing', {});

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Post not found');
      expect(commentsRepository.findPage).not.toHaveBeenCalled();
    });

    it('rejects an invalid cursor with 400 before any query', async () => {
      const promise = service.list('post-1', { cursor: 'not a cursor!' });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      expect(postsRepository.findById).not.toHaveBeenCalled();
      expect(commentsRepository.findPage).not.toHaveBeenCalled();
    });

    it('reads the first page (default 20, limit + 1 rows) and maps views without ids', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      commentsRepository.findPage.mockResolvedValue([COMMENT]);

      const page = await service.list('post-1', {});

      expect(commentsRepository.findPage).toHaveBeenCalledWith({
        postId: 'post-1',
        cursor: undefined,
        limit: 20,
      });
      expect(page).toEqual({
        items: [
          {
            id: 'comment-1',
            body: 'nice',
            createdAt: CREATED_AT,
            author: { username: 'author' },
          },
        ],
        nextCursor: null,
      });
      expect(page.items[0]).not.toHaveProperty('authorId');
      expect(page.items[0]).not.toHaveProperty('postId');
    });

    it('passes the decoded cursor and the requested page size', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      commentsRepository.findPage.mockResolvedValue([]);
      const cursor = encodeCursor({ createdAt: CREATED_AT, id: 'comment-5' });

      await service.list('post-1', { cursor, limit: 5 });

      expect(commentsRepository.findPage).toHaveBeenCalledWith({
        postId: 'post-1',
        cursor: { createdAt: CREATED_AT, id: 'comment-5' },
        limit: 5,
      });
    });

    it('returns exactly `limit` items and no nextCursor when there are exactly `limit` rows', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      commentsRepository.findPage.mockResolvedValue(commentRows(3));

      const page = await service.list('post-1', { limit: 3 });

      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    });

    it('drops the extra row and points nextCursor at the last returned item', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      commentsRepository.findPage.mockResolvedValue(commentRows(4));

      const page = await service.list('post-1', { limit: 3 });

      expect(page.items.map((item) => item.id)).toEqual([
        'comment-001',
        'comment-002',
        'comment-003',
      ]);
      expect(page.nextCursor).not.toBeNull();
      expect(decodeCursor(page.nextCursor ?? '')).toEqual({
        createdAt: CREATED_AT,
        id: 'comment-003',
      });
    });
  });

  describe('create', () => {
    it('stores the trimmed body for the session user on the post', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      commentsRepository.create.mockResolvedValue(COMMENT);

      const view = await service.create('post-1', AUTHOR_ID, '  nice  ');

      expect(commentsRepository.create).toHaveBeenCalledWith({
        postId: 'post-1',
        authorId: AUTHOR_ID,
        body: 'nice',
      });
      expect(view).toEqual({
        id: 'comment-1',
        body: 'nice',
        createdAt: CREATED_AT,
        author: { username: 'author' },
      });
    });

    it('throws 404 Post not found for an unknown post and stores nothing', async () => {
      postsRepository.findById.mockResolvedValue(null);

      const promise = service.create('missing', AUTHOR_ID, 'nice');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Post not found');
      expect(commentsRepository.create).not.toHaveBeenCalled();
    });

    it('maps a concurrently deleted post (P2003) to 404', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      commentsRepository.create.mockRejectedValue(prismaError('P2003'));

      const promise = service.create('post-1', AUTHOR_ID, 'nice');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Post not found');
    });

    it('rethrows any other error', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      const error = prismaError('P2002');
      commentsRepository.create.mockRejectedValue(error);

      await expect(service.create('post-1', AUTHOR_ID, 'nice')).rejects.toBe(
        error,
      );
    });
  });

  describe('delete', () => {
    it("deletes the author's own comment, scoped to the author", async () => {
      commentsRepository.findById.mockResolvedValue(COMMENT);
      commentsRepository.deleteByIdAndAuthor.mockResolvedValue(1);

      await expect(
        service.delete('post-1', 'comment-1', AUTHOR_ID),
      ).resolves.toBeUndefined();
      expect(commentsRepository.deleteByIdAndAuthor).toHaveBeenCalledWith(
        'comment-1',
        AUTHOR_ID,
      );
    });

    it('throws 404 Comment not found for an unknown comment', async () => {
      commentsRepository.findById.mockResolvedValue(null);

      const promise = service.delete('post-1', 'missing', AUTHOR_ID);

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Comment not found');
      expect(commentsRepository.deleteByIdAndAuthor).not.toHaveBeenCalled();
    });

    it('throws 404 when the comment belongs to another post', async () => {
      commentsRepository.findById.mockResolvedValue(COMMENT);

      const promise = service.delete('post-2', 'comment-1', AUTHOR_ID);

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Comment not found');
      expect(commentsRepository.deleteByIdAndAuthor).not.toHaveBeenCalled();
    });

    it("throws 403 for someone else's comment and deletes nothing", async () => {
      commentsRepository.findById.mockResolvedValue(COMMENT);

      const promise = service.delete('post-1', 'comment-1', OTHER_ID);

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow(
        'You can only delete your own comments',
      );
      expect(commentsRepository.deleteByIdAndAuthor).not.toHaveBeenCalled();
    });

    it('throws 404 when the comment is deleted concurrently (0 rows)', async () => {
      commentsRepository.findById.mockResolvedValue(COMMENT);
      commentsRepository.deleteByIdAndAuthor.mockResolvedValue(0);

      const promise = service.delete('post-1', 'comment-1', AUTHOR_ID);

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Comment not found');
    });
  });
});
