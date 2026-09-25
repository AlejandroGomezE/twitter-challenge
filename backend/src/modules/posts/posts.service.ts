import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { FollowsService } from '../follows/follows.service.js';
import {
  type CursorPosition,
  decodeCursor,
  encodeCursor,
  resolvePageSize,
} from './pagination.js';
import {
  type PostCounts,
  PostsRepository,
  type PostWithAuthor,
} from './posts.repository.js';
import { normalizeBody } from './posts.rules.js';

// A post as any signed-in viewer sees it; `likedByMe` is per viewer.
export interface PostView {
  id: string;
  body: string;
  createdAt: Date;
  author: { username: string; displayName: string | null };
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

// Query of a paged listing: an opaque cursor from a previous page's
// `nextCursor` (omitted for the first page) and an optional page size.
export interface PageQuery {
  cursor?: string;
  limit?: number;
}

// One page of posts, newest first. `nextCursor` is null on the last page.
export interface PostPage {
  items: PostView[];
  nextCursor: string | null;
}

// The viewer's like state on a post after a like/unlike, with the new total.
export interface LikeState {
  liked: boolean;
  likeCount: number;
}

const POST_NOT_FOUND_MESSAGE = 'Post not found';
// Prisma's code for a foreign-key violation.
const FOREIGN_KEY_VIOLATION = 'P2003';
const NOT_POST_AUTHOR_MESSAGE = 'You can only delete your own posts';

const NO_ACTIVITY: PostCounts = {
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
};

@Injectable()
export class PostsService {
  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly followsService: FollowsService,
  ) {}

  // `authorId` is always the session user's id. A new post has no likes or
  // comments yet, so no count queries are needed.
  async create(authorId: string, body: string): Promise<PostView> {
    const post = await this.postsRepository.create({
      authorId,
      body: normalizeBody(body),
    });
    return this.toView(post, NO_ACTIVITY);
  }

  async getById(id: string, viewerId: string): Promise<PostView> {
    const post = await this.postsRepository.findById(id);
    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND_MESSAGE);
    }
    const counts = await this.postsRepository.countsFor([post.id], viewerId);
    return this.toView(post, counts.get(post.id) ?? NO_ACTIVITY);
  }

  // Hard delete; likes and comments cascade. The delete itself is also
  // scoped to the author, so a concurrent delete surfaces as a 404.
  async delete(id: string, userId: string): Promise<void> {
    const post = await this.postsRepository.findById(id);
    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND_MESSAGE);
    }
    if (post.authorId !== userId) {
      throw new ForbiddenException(NOT_POST_AUTHOR_MESSAGE);
    }
    const deleted = await this.postsRepository.deleteByIdAndAuthor(id, userId);
    if (deleted === 0) {
      throw new NotFoundException(POST_NOT_FOUND_MESSAGE);
    }
  }

  // Likes (`liked: true`) or unlikes the post as `userId` (the session
  // user); both are idempotent. 404 if the post doesn't exist — checked
  // first, and again via the FK violation (P2003) if the post is deleted
  // between the check and the insert, so that race is a 404, not a 500.
  async setLiked(
    postId: string,
    userId: string,
    liked: boolean,
  ): Promise<LikeState> {
    const post = await this.postsRepository.findById(postId);
    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND_MESSAGE);
    }
    try {
      if (liked) {
        await this.postsRepository.like(userId, postId);
      } else {
        await this.postsRepository.unlike(userId, postId);
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new NotFoundException(POST_NOT_FOUND_MESSAGE);
      }
      throw error;
    }
    const likeCount = await this.postsRepository.likeCount(postId);
    return { liked, likeCount };
  }

  // The viewer's Following feed: posts by everyone in the feed author set.
  // The cursor is validated before the author set is read.
  async feed(viewerId: string, query: PageQuery): Promise<PostPage> {
    const cursor = this.parseCursor(query);
    const authorIds = await this.feedAuthorIds(viewerId);
    return this.page(authorIds, viewerId, cursor, query.limit);
  }

  // The "for you" feed: every user's posts, newest first.
  async forYou(viewerId: string, query: PageQuery): Promise<PostPage> {
    return this.page(undefined, viewerId, this.parseCursor(query), query.limit);
  }

  // One author's posts (the profile Posts tab). `authorId` must be an
  // existing user's id — the users module resolves the username.
  async listByAuthor(
    authorId: string,
    viewerId: string,
    query: PageQuery,
  ): Promise<PostPage> {
    return this.page(
      [authorId],
      viewerId,
      this.parseCursor(query),
      query.limit,
    );
  }

  countByAuthor(authorId: string): Promise<number> {
    return this.postsRepository.countByAuthor(authorId);
  }

  // THE feed extension point: whose posts appear in `viewerId`'s Following
  // feed — the viewer plus every user they follow (one query).
  private async feedAuthorIds(viewerId: string): Promise<string[]> {
    const followedIds = await this.followsService.followedIds(viewerId);
    return [viewerId, ...followedIds];
  }

  // Decodes the query's cursor; an invalid one is a 400 `Invalid cursor`,
  // thrown before any query runs.
  private parseCursor(query: PageQuery): CursorPosition | undefined {
    return query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  }

  // Keyset page over (createdAt, id), by `authorIds` or by everyone when
  // undefined: one query for the posts (limit + 1 rows to detect a next
  // page) plus the constant count queries of countsFor — never one query
  // per post.
  private async page(
    authorIds: string[] | undefined,
    viewerId: string,
    cursor: CursorPosition | undefined,
    requestedLimit: number | undefined,
  ): Promise<PostPage> {
    const limit = resolvePageSize(requestedLimit);
    const rows = await this.postsRepository.findPage({
      authorIds,
      cursor,
      limit,
    });
    const posts = rows.slice(0, limit);
    const last = posts.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    const counts = await this.postsRepository.countsFor(
      posts.map((post) => post.id),
      viewerId,
    );
    return {
      items: posts.map((post) =>
        this.toView(post, counts.get(post.id) ?? NO_ACTIVITY),
      ),
      nextCursor,
    };
  }

  private toView(post: PostWithAuthor, counts: PostCounts): PostView {
    return {
      id: post.id,
      body: post.body,
      createdAt: post.createdAt,
      author: {
        username: post.author.username,
        displayName: post.author.displayName,
      },
      likeCount: counts.likeCount,
      commentCount: counts.commentCount,
      likedByMe: counts.likedByMe,
    };
  }
}
