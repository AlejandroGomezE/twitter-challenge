import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../generated/prisma/client.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { PostsRepository, type PostWithAuthor } from '../posts.repository.js';
import { PostsService } from '../posts.service.js';

const AUTHOR_ID = 'user-author';
const OTHER_ID = 'user-other';
const CREATED_AT = new Date('2026-09-24T10:00:00.000Z');

const POST: PostWithAuthor = {
  id: 'post-1',
  authorId: AUTHOR_ID,
  body: 'hello world',
  createdAt: CREATED_AT,
  author: { username: 'author' },
};

// `count` posts by AUTHOR_ID, newest first, all sharing one timestamp so the
// id is the only tiebreaker (ids descend like the repository's ordering).
function postRows(count: number): PostWithAuthor[] {
  return Array.from({ length: count }, (_, index) => ({
    ...POST,
    id: `post-${String(count - index).padStart(3, '0')}`,
  }));
}

describe('PostsService', () => {
  let service: PostsService;

  const postsRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    deleteByIdAndAuthor: vi.fn(),
    countsFor: vi.fn(),
    findPage: vi.fn(),
    countByAuthor: vi.fn(),
    like: vi.fn(),
    unlike: vi.fn(),
    likeCount: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PostsRepository, useValue: postsRepository },
      ],
    }).compile();
    service = moduleRef.get(PostsService);
  });

  describe('create', () => {
    it('stores the trimmed body for the given author and returns a fresh view', async () => {
      postsRepository.create.mockResolvedValue(POST);

      const view = await service.create(AUTHOR_ID, '  hello world  ');

      expect(postsRepository.create).toHaveBeenCalledWith({
        authorId: AUTHOR_ID,
        body: 'hello world',
      });
      expect(view).toEqual({
        id: 'post-1',
        body: 'hello world',
        createdAt: CREATED_AT,
        author: { username: 'author' },
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
      });
      // A new post has no activity: no count queries.
      expect(postsRepository.countsFor).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns the post with its counts for the viewer', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      postsRepository.countsFor.mockResolvedValue(
        new Map([
          ['post-1', { likeCount: 3, commentCount: 2, likedByMe: true }],
        ]),
      );

      const view = await service.getById('post-1', OTHER_ID);

      expect(postsRepository.countsFor).toHaveBeenCalledWith(
        ['post-1'],
        OTHER_ID,
      );
      expect(view).toEqual({
        id: 'post-1',
        body: 'hello world',
        createdAt: CREATED_AT,
        author: { username: 'author' },
        likeCount: 3,
        commentCount: 2,
        likedByMe: true,
      });
      // The author's id is not part of the view.
      expect(view).not.toHaveProperty('authorId');
    });

    it('throws 404 Post not found for an unknown id', async () => {
      postsRepository.findById.mockResolvedValue(null);

      const promise = service.getById('missing', OTHER_ID);

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Post not found');
      expect(postsRepository.countsFor).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it("deletes the author's own post, scoped to the author", async () => {
      postsRepository.findById.mockResolvedValue(POST);
      postsRepository.deleteByIdAndAuthor.mockResolvedValue(1);

      await expect(
        service.delete('post-1', AUTHOR_ID),
      ).resolves.toBeUndefined();

      expect(postsRepository.deleteByIdAndAuthor).toHaveBeenCalledWith(
        'post-1',
        AUTHOR_ID,
      );
    });

    it('throws 404 for an unknown id', async () => {
      postsRepository.findById.mockResolvedValue(null);

      const promise = service.delete('missing', AUTHOR_ID);

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Post not found');
      expect(postsRepository.deleteByIdAndAuthor).not.toHaveBeenCalled();
    });

    it("throws 403 for someone else's post and deletes nothing", async () => {
      postsRepository.findById.mockResolvedValue(POST);

      const promise = service.delete('post-1', OTHER_ID);

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow(
        'You can only delete your own posts',
      );
      expect(postsRepository.deleteByIdAndAuthor).not.toHaveBeenCalled();
    });

    it('throws 404 when the post disappears before the delete', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      postsRepository.deleteByIdAndAuthor.mockResolvedValue(0);

      await expect(service.delete('post-1', AUTHOR_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setLiked', () => {
    function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
      return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
        code,
        clientVersion: 'test',
      });
    }

    it('likes the post as the given user and returns { liked: true, likeCount }', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      postsRepository.like.mockResolvedValue(undefined);
      postsRepository.likeCount.mockResolvedValue(3);

      await expect(service.setLiked('post-1', OTHER_ID, true)).resolves.toEqual(
        { liked: true, likeCount: 3 },
      );
      expect(postsRepository.like).toHaveBeenCalledWith(OTHER_ID, 'post-1');
      expect(postsRepository.unlike).not.toHaveBeenCalled();
      expect(postsRepository.likeCount).toHaveBeenCalledWith('post-1');
    });

    it('unlikes the post as the given user and returns { liked: false, likeCount }', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      postsRepository.unlike.mockResolvedValue(undefined);
      postsRepository.likeCount.mockResolvedValue(0);

      await expect(
        service.setLiked('post-1', OTHER_ID, false),
      ).resolves.toEqual({ liked: false, likeCount: 0 });
      expect(postsRepository.unlike).toHaveBeenCalledWith(OTHER_ID, 'post-1');
      expect(postsRepository.like).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      'is idempotent: repeating liked=%s writes the same state and reports the same count',
      async (liked) => {
        postsRepository.findById.mockResolvedValue(POST);
        postsRepository.likeCount.mockResolvedValue(liked ? 1 : 0);

        const first = await service.setLiked('post-1', OTHER_ID, liked);
        const second = await service.setLiked('post-1', OTHER_ID, liked);

        expect(second).toEqual(first);
        expect(first).toEqual({ liked, likeCount: liked ? 1 : 0 });
        const write = liked ? postsRepository.like : postsRepository.unlike;
        expect(write).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenNthCalledWith(1, OTHER_ID, 'post-1');
        expect(write).toHaveBeenNthCalledWith(2, OTHER_ID, 'post-1');
      },
    );

    it.each([true, false])(
      'throws 404 Post not found for an unknown post (liked=%s) and writes nothing',
      async (liked) => {
        postsRepository.findById.mockResolvedValue(null);

        const promise = service.setLiked('missing', OTHER_ID, liked);

        await expect(promise).rejects.toBeInstanceOf(NotFoundException);
        await expect(promise).rejects.toThrow('Post not found');
        expect(postsRepository.like).not.toHaveBeenCalled();
        expect(postsRepository.unlike).not.toHaveBeenCalled();
        expect(postsRepository.likeCount).not.toHaveBeenCalled();
      },
    );

    it('maps a FK violation (post deleted after the check) to 404 Post not found', async () => {
      postsRepository.findById.mockResolvedValue(POST);
      postsRepository.like.mockRejectedValue(prismaError('P2003'));

      const promise = service.setLiked('post-1', OTHER_ID, true);

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Post not found');
      expect(postsRepository.likeCount).not.toHaveBeenCalled();
    });

    it('rethrows other errors unchanged', async () => {
      const error = prismaError('P2025');
      postsRepository.findById.mockResolvedValue(POST);
      postsRepository.like.mockRejectedValue(error);

      await expect(service.setLiked('post-1', OTHER_ID, true)).rejects.toBe(
        error,
      );
    });
  });

  describe('feed', () => {
    beforeEach(() => {
      postsRepository.countsFor.mockImplementation((ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              { likeCount: 0, commentCount: 0, likedByMe: false },
            ]),
          ),
        ),
      );
    });

    it("pages the viewer's own posts only (the feed author set is [viewer])", async () => {
      postsRepository.findPage.mockResolvedValue([]);

      await service.feed(AUTHOR_ID, {});

      expect(postsRepository.findPage).toHaveBeenCalledWith({
        authorIds: [AUTHOR_ID],
        cursor: undefined,
        limit: 20,
      });
    });

    it('returns an empty last page when there are no posts', async () => {
      postsRepository.findPage.mockResolvedValue([]);

      await expect(service.feed(AUTHOR_ID, {})).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(postsRepository.countsFor).toHaveBeenCalledWith([], AUTHOR_ID);
    });

    it('has no next page when exactly `limit` rows come back', async () => {
      postsRepository.findPage.mockResolvedValue(postRows(5));

      const page = await service.feed(AUTHOR_ID, { limit: 5 });

      expect(page.items).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
    });

    it('returns `limit` items and a cursor at the last one when `limit + 1` rows come back', async () => {
      const rows = postRows(6);
      postsRepository.findPage.mockResolvedValue(rows);

      const page = await service.feed(AUTHOR_ID, { limit: 5 });

      expect(page.items.map((item) => item.id)).toEqual(
        rows.slice(0, 5).map((row) => row.id),
      );
      expect(page.nextCursor).not.toBeNull();
      expect(decodeCursor(page.nextCursor ?? '')).toEqual({
        createdAt: CREATED_AT,
        id: rows[4].id,
      });
    });

    it('passes the decoded cursor and the requested page size to the repository', async () => {
      postsRepository.findPage.mockResolvedValue([]);
      const position = { createdAt: CREATED_AT, id: 'post-050' };

      await service.feed(AUTHOR_ID, {
        cursor: encodeCursor(position),
        limit: 35,
      });

      expect(postsRepository.findPage).toHaveBeenCalledWith({
        authorIds: [AUTHOR_ID],
        cursor: position,
        limit: 35,
      });
    });

    it('fetches counts once for the whole page (no N+1) and merges them per post', async () => {
      const rows = postRows(3);
      postsRepository.findPage.mockResolvedValue(rows);
      postsRepository.countsFor.mockResolvedValue(
        new Map([
          [rows[0].id, { likeCount: 4, commentCount: 1, likedByMe: true }],
          [rows[1].id, { likeCount: 0, commentCount: 0, likedByMe: false }],
          [rows[2].id, { likeCount: 2, commentCount: 7, likedByMe: false }],
        ]),
      );

      const page = await service.feed(OTHER_ID, { limit: 10 });

      expect(postsRepository.countsFor).toHaveBeenCalledTimes(1);
      expect(postsRepository.countsFor).toHaveBeenCalledWith(
        rows.map((row) => row.id),
        OTHER_ID,
      );
      expect(page.items[0]).toEqual({
        id: rows[0].id,
        body: 'hello world',
        createdAt: CREATED_AT,
        author: { username: 'author' },
        likeCount: 4,
        commentCount: 1,
        likedByMe: true,
      });
      expect(page.items[2]).toMatchObject({ likeCount: 2, commentCount: 7 });
      expect(page.items[0]).not.toHaveProperty('authorId');
    });

    it('rejects an invalid cursor with 400 Invalid cursor before querying', async () => {
      const promise = service.feed(AUTHOR_ID, { cursor: 'not a cursor' });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow('Invalid cursor');
      expect(postsRepository.findPage).not.toHaveBeenCalled();
    });
  });

  describe('listByAuthor', () => {
    it("pages only that author's posts, with counts for the viewer", async () => {
      postsRepository.findPage.mockResolvedValue(postRows(2));
      postsRepository.countsFor.mockResolvedValue(new Map());
      const position = { createdAt: CREATED_AT, id: 'post-009' };

      const page = await service.listByAuthor(AUTHOR_ID, OTHER_ID, {
        cursor: encodeCursor(position),
        limit: 2,
      });

      expect(postsRepository.findPage).toHaveBeenCalledWith({
        authorIds: [AUTHOR_ID],
        cursor: position,
        limit: 2,
      });
      expect(postsRepository.countsFor).toHaveBeenCalledWith(
        ['post-002', 'post-001'],
        OTHER_ID,
      );
      // Missing count entries fall back to zeros.
      expect(page.items[1]).toMatchObject({
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
      });
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('countByAuthor', () => {
    it("returns the repository's count for the author", async () => {
      postsRepository.countByAuthor.mockResolvedValue(7);

      await expect(service.countByAuthor(AUTHOR_ID)).resolves.toBe(7);
      expect(postsRepository.countByAuthor).toHaveBeenCalledWith(AUTHOR_ID);
    });
  });
});
