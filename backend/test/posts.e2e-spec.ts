import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AuthService } from './../src/auth/auth.service.js';
import { SESSION_COOKIE } from './../src/auth/session.constants.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { UsersService } from './../src/modules/users/users.service.js';

// E2e coverage of the twitter-posts feature: posts, feed, a user's posts,
// likes and comments. Runs on the dedicated e2e.db (vitest.config.e2e.ts).
// beforeEach builds a fresh app, so the in-memory throttle counters never
// leak between tests; afterEach deletes every created user (their posts,
// likes and comments cascade).

const FRONTEND_ORIGIN = 'http://localhost:5173';
const FOREIGN_ORIGIN = 'http://evil.test';

const POST_KEYS = [
  'author',
  'body',
  'commentCount',
  'createdAt',
  'id',
  'likeCount',
  'likedByMe',
];
const COMMENT_KEYS = ['author', 'body', 'createdAt', 'id'];
const PAGE_KEYS = ['items', 'nextCursor'];

// Keys that must never appear in any response body.
const NEVER_EXPOSED_KEYS = new Set(['passwordHash', 'tokenHash']);

type Method = 'get' | 'post' | 'put' | 'delete' | 'patch';

interface PostJson {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string };
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

interface CommentJson {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string };
}

interface PageJson<T> {
  items: T[];
  nextCursor: string | null;
}

interface TestUser {
  userId: string;
  username: string;
  email: string;
  token: string;
}

interface CallOptions {
  token?: string;
  // Omitted -> the trusted frontend origin; null -> no Origin header.
  origin?: string | null;
  body?: Record<string, unknown>;
  query?: Record<string, string | number>;
}

interface RecordedResponse {
  method: Method;
  path: string;
  body: unknown;
}

// Returns the dotted paths of every forbidden key found anywhere in `value`.
function findForbiddenKeys(
  value: unknown,
  forbidden: Set<string>,
  at = '$',
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenKeys(item, forbidden, `${at}[${index}]`),
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(forbidden.has(key) ? [`${at}.${key}`] : []),
      ...findForbiddenKeys(child, forbidden, `${at}.${key}`),
    ]);
  }
  return [];
}

// Keyset order of a post listing: createdAt DESC, id DESC.
function newestFirst(
  a: { createdAt: Date; id: string },
  b: { createdAt: Date; id: string },
): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

describe('Posts (e2e)', () => {
  let app: INestApplication;
  const createdUserIds: string[] = [];
  const createdEmails: string[] = [];
  const responses: RecordedResponse[] = [];

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    try {
      assertNoLeaks();
    } finally {
      try {
        if (createdUserIds.length > 0) {
          await app
            .get(PrismaService)
            .user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
      } finally {
        createdUserIds.length = 0;
        createdEmails.length = 0;
        responses.length = 0;
        await app.close();
      }
    }
  });

  // Serialization guard over every response the test received through
  // `call`: never a passwordHash/tokenHash, and no `email` key or any test
  // user's email address except in the caller's own profile (PATCH
  // /users/me) and /auth/me.
  function assertNoLeaks(): void {
    for (const { method, path, body } of responses) {
      const emailAllowed =
        (method === 'patch' && path === '/users/me') ||
        (method === 'get' && path === '/auth/me');
      const forbidden = new Set(NEVER_EXPOSED_KEYS);
      if (!emailAllowed) {
        forbidden.add('email');
      }
      const found = findForbiddenKeys(body, forbidden);
      if (found.length > 0) {
        throw new Error(
          `${method.toUpperCase()} ${path} leaked ${found.join(', ')}`,
        );
      }
      if (!emailAllowed) {
        const text = JSON.stringify(body ?? null);
        const leaked = createdEmails.find((email) => text.includes(email));
        if (leaked) {
          throw new Error(
            `${method.toUpperCase()} ${path} leaked an email address`,
          );
        }
      }
    }
  }

  function uniqueUsername(): string {
    return `e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }

  async function createUserWithSession(): Promise<TestUser> {
    const email = `e2e-${randomUUID()}@example.test`;
    const user = await app
      .get(UsersService)
      .create(email, uniqueUsername(), 'correct-horse-battery');
    createdUserIds.push(user.id);
    createdEmails.push(email);
    const { token } = await app.get(AuthService).createSession(user.id);
    return { userId: user.id, username: user.username, email, token };
  }

  // Sends one request and records its body for the serialization guard.
  async function call(
    method: Method,
    path: string,
    options: CallOptions = {},
  ): Promise<Response> {
    let req = request(app.getHttpServer())[method](path);
    const origin =
      options.origin === undefined ? FRONTEND_ORIGIN : options.origin;
    if (origin !== null) {
      req = req.set('Origin', origin);
    }
    if (options.token) {
      req = req.set('Cookie', `${SESSION_COOKIE}=${options.token}`);
    }
    if (options.query) {
      req = req.query(options.query);
    }
    const res = options.body ? await req.send(options.body) : await req;
    responses.push({ method, path, body: res.body as unknown });
    return res;
  }

  async function createPost(user: TestUser, body: string): Promise<PostJson> {
    const res = await call('post', '/posts', {
      token: user.token,
      body: { body },
    });
    expect(res.status).toBe(201);
    return res.body as PostJson;
  }

  async function createComment(
    user: TestUser,
    postId: string,
    body: string,
  ): Promise<CommentJson> {
    const res = await call('post', `/posts/${postId}/comments`, {
      token: user.token,
      body: { body },
    });
    expect(res.status).toBe(201);
    return res.body as CommentJson;
  }

  async function getPost(user: TestUser, postId: string): Promise<PostJson> {
    const res = await call('get', `/posts/${postId}`, { token: user.token });
    expect(res.status).toBe(200);
    return res.body as PostJson;
  }

  // Walks a cursor-paged listing to its end, asserting the page shape.
  async function walk<T extends { id: string }>(
    path: string,
    token: string,
    limit?: number,
  ): Promise<{ items: T[]; pageSizes: number[] }> {
    const items: T[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const query: Record<string, string | number> = {};
      if (limit !== undefined) {
        query.limit = limit;
      }
      if (cursor !== undefined) {
        query.cursor = cursor;
      }
      const res = await call('get', path, { token, query });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body as object).sort()).toEqual(PAGE_KEYS);
      const body = res.body as PageJson<T>;
      items.push(...body.items);
      pageSizes.push(body.items.length);
      if (body.nextCursor === null) {
        return { items, pageSizes };
      }
      expect(typeof body.nextCursor).toBe('string');
      cursor = body.nextCursor;
    }
    throw new Error(`Pagination of ${path} did not terminate`);
  }

  // Inserts `count` posts for `authorId` directly, in groups of `tieSize`
  // sharing one createdAt, and returns them in listing order (newest first).
  async function seedPosts(
    authorId: string,
    count: number,
    tieSize: number,
    base: Date,
  ): Promise<{ id: string; createdAt: Date }[]> {
    const prisma = app.get(PrismaService);
    await prisma.post.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        authorId,
        body: `seeded post ${i}`,
        createdAt: new Date(base.getTime() + Math.floor(i / tieSize) * 1000),
      })),
    });
    const rows = await prisma.post.findMany({
      where: { authorId },
      select: { id: true, createdAt: true },
    });
    return rows.sort(newestFirst);
  }

  function expectPostShape(post: unknown): void {
    expect(Object.keys(post as object).sort()).toEqual(POST_KEYS);
    expect(Object.keys((post as PostJson).author).sort()).toEqual(['username']);
  }

  it('the serialization guard sees every recorded response (self-check)', async () => {
    const me = await createUserWithSession();
    await call('get', '/feed', { token: me.token });
    expect(responses).toHaveLength(1);
    expect(
      findForbiddenKeys({ a: [{ b: { email: 'x' } }] }, new Set(['email'])),
    ).toEqual(['$.a[0].b.email']);
  });

  describe('POST /posts', () => {
    it('returns 201 with exactly the post fields, author { username } only, body trimmed', async () => {
      const me = await createUserWithSession();
      const res = await call('post', '/posts', {
        token: me.token,
        body: { body: '  hello\nworld  ' },
      });

      expect(res.status).toBe(201);
      expectPostShape(res.body);
      expect(res.body).toEqual({
        id: expect.any(String),
        body: 'hello\nworld',
        createdAt: expect.any(String),
        author: { username: me.username },
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
      });
      const createdAt = (res.body as PostJson).createdAt;
      expect(new Date(createdAt).toISOString()).toBe(createdAt);

      const row = await app
        .get(PrismaService)
        .post.findUniqueOrThrow({ where: { id: (res.body as PostJson).id } });
      expect(row.body).toBe('hello\nworld');
      expect(row.authorId).toBe(me.userId);
    });

    it.each([
      ['empty', ''],
      ['whitespace-only', '  \n\t  '],
      ['281 code points', 'a'.repeat(281)],
      ['281 emoji', '😀'.repeat(281)],
      // A JSON number is not a string: no implicit conversion to "123".
      ['number', 123],
    ])('rejects a %s body with 400', async (_label, body) => {
      const me = await createUserWithSession();
      const res = await call('post', '/posts', {
        token: me.token,
        body: { body },
      });
      expect(res.status).toBe(400);
      expect(
        await app
          .get(PrismaService)
          .post.count({ where: { authorId: me.userId } }),
      ).toBe(0);
    });

    it('rejects a missing body with 400', async () => {
      const me = await createUserWithSession();
      expect(
        (await call('post', '/posts', { token: me.token, body: {} })).status,
      ).toBe(400);
    });

    it('counts code points: 280 emoji is accepted, 280 chars plus padding too', async () => {
      const me = await createUserWithSession();
      const emoji = '😀'.repeat(280);
      expect(emoji.length).toBe(560); // UTF-16 units, over 280
      const post = await createPost(me, emoji);
      expect(post.body).toBe(emoji);

      const padded = await createPost(me, `   ${'b'.repeat(280)}   `);
      expect(padded.body).toBe('b'.repeat(280));
    });

    it('ignores an authorId in the body: the author is always the session user', async () => {
      const me = await createUserWithSession();
      const other = await createUserWithSession();

      const res = await call('post', '/posts', {
        token: me.token,
        body: { body: 'mine', authorId: other.userId },
      });
      expect(res.status).toBe(201);
      expect((res.body as PostJson).author).toEqual({ username: me.username });
      const row = await app
        .get(PrismaService)
        .post.findUniqueOrThrow({ where: { id: (res.body as PostJson).id } });
      expect(row.authorId).toBe(me.userId);
      expect(
        await app
          .get(PrismaService)
          .post.count({ where: { authorId: other.userId } }),
      ).toBe(0);
    });

    it('from a foreign Origin returns 403 and creates nothing', async () => {
      const me = await createUserWithSession();
      const res = await call('post', '/posts', {
        token: me.token,
        origin: FOREIGN_ORIGIN,
        body: { body: 'csrf' },
      });
      expect(res.status).toBe(403);
      expect(
        await app
          .get(PrismaService)
          .post.count({ where: { authorId: me.userId } }),
      ).toBe(0);
    });

    it('without a session returns 401', async () => {
      const res = await call('post', '/posts', { body: { body: 'anon' } });
      expect(res.status).toBe(401);
    });

    it('is rate limited to 10 posts per minute per user; other users are unaffected', async () => {
      const me = await createUserWithSession();
      const other = await createUserWithSession();
      for (let i = 0; i < 10; i++) {
        await createPost(me, `post ${i}`);
      }
      const res = await call('post', '/posts', {
        token: me.token,
        body: { body: 'one too many' },
      });
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        statusCode: 429,
        message: expect.any(String),
        timestamp: expect.any(String),
        path: '/posts',
      });
      expect(
        await app
          .get(PrismaService)
          .post.count({ where: { authorId: me.userId } }),
      ).toBe(10);

      await createPost(other, 'still allowed');
    });
  });

  describe('GET /posts/:id', () => {
    it("returns the post with the viewer's own likedByMe", async () => {
      const author = await createUserWithSession();
      const liker = await createUserWithSession();
      const viewer = await createUserWithSession();
      const post = await createPost(author, 'hello');
      expect(
        (await call('put', `/posts/${post.id}/like`, { token: liker.token }))
          .status,
      ).toBe(200);

      const asLiker = await getPost(liker, post.id);
      expectPostShape(asLiker);
      expect(asLiker).toEqual({ ...post, likeCount: 1, likedByMe: true });

      const asViewer = await getPost(viewer, post.id);
      expect(asViewer).toEqual({ ...post, likeCount: 1, likedByMe: false });
      const asAuthor = await getPost(author, post.id);
      expect(asAuthor.likedByMe).toBe(false);
    });

    it('an unknown id returns 404', async () => {
      const me = await createUserWithSession();
      const res = await call('get', `/posts/${randomUUID()}`, {
        token: me.token,
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Post not found');
    });

    it('without a session returns 401', async () => {
      const me = await createUserWithSession();
      const post = await createPost(me, 'hello');
      expect((await call('get', `/posts/${post.id}`)).status).toBe(401);
    });
  });

  describe('DELETE /posts/:id', () => {
    it('deletes your own post (204) with its likes and comments', async () => {
      const me = await createUserWithSession();
      const other = await createUserWithSession();
      const post = await createPost(me, 'to delete');
      const keep = await createPost(me, 'to keep');
      await call('put', `/posts/${post.id}/like`, { token: me.token });
      await call('put', `/posts/${post.id}/like`, { token: other.token });
      await createComment(me, post.id, 'c1');
      await createComment(other, post.id, 'c2');
      await call('put', `/posts/${keep.id}/like`, { token: other.token });
      await createComment(other, keep.id, 'kept');

      const prisma = app.get(PrismaService);
      expect(await prisma.like.count({ where: { postId: post.id } })).toBe(2);
      expect(await prisma.comment.count({ where: { postId: post.id } })).toBe(
        2,
      );

      const res = await call('delete', `/posts/${post.id}`, {
        token: me.token,
      });
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      expect(
        (await call('get', `/posts/${post.id}`, { token: me.token })).status,
      ).toBe(404);
      expect(
        (await call('get', `/posts/${post.id}/comments`, { token: me.token }))
          .status,
      ).toBe(404);
      expect(await prisma.like.count({ where: { postId: post.id } })).toBe(0);
      expect(await prisma.comment.count({ where: { postId: post.id } })).toBe(
        0,
      );

      // The other post and its activity are untouched.
      const kept = await getPost(me, keep.id);
      expect(kept.likeCount).toBe(1);
      expect(kept.commentCount).toBe(1);
      const feed = await walk<PostJson>('/feed', me.token);
      expect(feed.items.map((p) => p.id)).toEqual([keep.id]);
    });

    it("someone else's post returns 403 and leaves it in place", async () => {
      const author = await createUserWithSession();
      const other = await createUserWithSession();
      const post = await createPost(author, 'not yours');

      const res = await call('delete', `/posts/${post.id}`, {
        token: other.token,
      });
      expect(res.status).toBe(403);
      await getPost(author, post.id);
    });

    it('an unknown id returns 404', async () => {
      const me = await createUserWithSession();
      const res = await call('delete', `/posts/${randomUUID()}`, {
        token: me.token,
      });
      expect(res.status).toBe(404);
    });

    it('from a foreign Origin returns 403 and leaves the post in place', async () => {
      const me = await createUserWithSession();
      const post = await createPost(me, 'stays');
      const res = await call('delete', `/posts/${post.id}`, {
        token: me.token,
        origin: FOREIGN_ORIGIN,
      });
      expect(res.status).toBe(403);
      await getPost(me, post.id);
    });

    it('without a session returns 401', async () => {
      const me = await createUserWithSession();
      const post = await createPost(me, 'stays');
      expect((await call('delete', `/posts/${post.id}`)).status).toBe(401);
      await getPost(me, post.id);
    });
  });

  describe('GET /feed', () => {
    it('lists only your own posts, newest first, as { items, nextCursor }', async () => {
      const me = await createUserWithSession();
      const other = await createUserWithSession();
      const mine = [
        await createPost(me, 'first'),
        await createPost(me, 'second'),
        await createPost(me, 'third'),
      ];
      await createPost(other, 'not in my feed');

      const res = await call('get', '/feed', { token: me.token });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body as object).sort()).toEqual(PAGE_KEYS);
      const page = res.body as PageJson<PostJson>;
      expect(page.nextCursor).toBeNull();
      page.items.forEach(expectPostShape);
      expect(page.items.every((p) => p.author.username === me.username)).toBe(
        true,
      );

      const expected = mine
        .map((p) => ({ id: p.id, createdAt: new Date(p.createdAt) }))
        .sort(newestFirst)
        .map((p) => p.id);
      expect(page.items.map((p) => p.id)).toEqual(expected);
    });

    it('an empty feed is { items: [], nextCursor: null }', async () => {
      const me = await createUserWithSession();
      const res = await call('get', '/feed', { token: me.token });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    });

    it('walks 49 posts with tied timestamps exactly: no skips, no duplicates, null cursor at the end', async () => {
      const me = await createUserWithSession();
      const other = await createUserWithSession();
      const base = new Date(Date.now() - 60 * 60 * 1000);
      // Groups of 4 posts share a createdAt; another user's posts share the
      // same timestamps and must never show up.
      const expected = (await seedPosts(me.userId, 49, 4, base)).map(
        (p) => p.id,
      );
      await seedPosts(other.userId, 12, 4, base);
      expect(new Set(expected).size).toBe(49);

      // 49 = 7 * 7: the last full page must already report nextCursor null.
      const byLimit7 = await walk<PostJson>('/feed', me.token, 7);
      expect(byLimit7.pageSizes).toEqual([7, 7, 7, 7, 7, 7, 7]);
      expect(byLimit7.items.map((p) => p.id)).toEqual(expected);
      expect(
        byLimit7.items.every((p) => p.author.username === me.username),
      ).toBe(true);

      const byDefault = await walk<PostJson>('/feed', me.token);
      expect(byDefault.pageSizes).toEqual([20, 20, 9]);
      expect(byDefault.items.map((p) => p.id)).toEqual(expected);

      const byMax = await walk<PostJson>('/feed', me.token, 50);
      expect(byMax.pageSizes).toEqual([49]);
      expect(byMax.items.map((p) => p.id)).toEqual(expected);
    });

    it.each([
      ['0', { limit: 0 }],
      ['51', { limit: 51 }],
      ['abc', { limit: 'abc' }],
      ['1.5', { limit: '1.5' }],
    ])('limit=%s returns 400', async (_label, query) => {
      const me = await createUserWithSession();
      const res = await call('get', '/feed', { token: me.token, query });
      expect(res.status).toBe(400);
    });

    it.each([
      ['empty', ''],
      ['not base64url', 'not a cursor!'],
      ['base64url of garbage', Buffer.from('garbage').toString('base64url')],
      [
        'wrong shape',
        Buffer.from(JSON.stringify({ createdAt: 1 })).toString('base64url'),
      ],
      [
        'non-canonical date',
        Buffer.from(JSON.stringify(['2024-01-01', 'abc'])).toString(
          'base64url',
        ),
      ],
    ])('a %s cursor returns 400 Invalid cursor', async (_label, cursor) => {
      const me = await createUserWithSession();
      const res = await call('get', '/feed', {
        token: me.token,
        query: { cursor },
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid cursor');
    });

    it('without a session returns 401', async () => {
      expect((await call('get', '/feed')).status).toBe(401);
    });
  });

  describe('GET /users/:username/posts', () => {
    it("lists that user's posts only (case-insensitive username), newest first, same paging", async () => {
      const author = await createUserWithSession();
      const viewer = await createUserWithSession();
      const base = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const expected = (await seedPosts(author.userId, 23, 3, base)).map(
        (p) => p.id,
      );
      await seedPosts(viewer.userId, 5, 3, base);

      const path = `/users/${author.username.toUpperCase()}/posts`;
      const byLimit5 = await walk<PostJson>(path, viewer.token, 5);
      expect(byLimit5.pageSizes).toEqual([5, 5, 5, 5, 3]);
      expect(byLimit5.items.map((p) => p.id)).toEqual(expected);
      byLimit5.items.forEach(expectPostShape);
      expect(
        byLimit5.items.every((p) => p.author.username === author.username),
      ).toBe(true);

      const byDefault = await walk<PostJson>(
        `/users/${author.username}/posts`,
        viewer.token,
      );
      expect(byDefault.pageSizes).toEqual([20, 3]);
      expect(byDefault.items.map((p) => p.id)).toEqual(expected);
    });

    it("carries the viewer's likedByMe and the counts", async () => {
      const author = await createUserWithSession();
      const viewer = await createUserWithSession();
      const liked = await createPost(author, 'liked');
      const plain = await createPost(author, 'plain');
      await call('put', `/posts/${liked.id}/like`, { token: viewer.token });
      await createComment(viewer, plain.id, 'hi');

      const { items } = await walk<PostJson>(
        `/users/${author.username}/posts`,
        viewer.token,
      );
      const byId = new Map(items.map((p) => [p.id, p]));
      expect(byId.get(liked.id)).toMatchObject({
        likeCount: 1,
        likedByMe: true,
        commentCount: 0,
      });
      expect(byId.get(plain.id)).toMatchObject({
        likeCount: 0,
        likedByMe: false,
        commentCount: 1,
      });

      const asAuthor = await walk<PostJson>(
        `/users/${author.username}/posts`,
        author.token,
      );
      expect(asAuthor.items.find((p) => p.id === liked.id)?.likedByMe).toBe(
        false,
      );
    });

    it('a user without posts is an empty page', async () => {
      const author = await createUserWithSession();
      const viewer = await createUserWithSession();
      const res = await call('get', `/users/${author.username}/posts`, {
        token: viewer.token,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    });

    it('an unknown user returns 404', async () => {
      const viewer = await createUserWithSession();
      const res = await call('get', `/users/${uniqueUsername()}/posts`, {
        token: viewer.token,
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('User not found');
    });

    it('rejects a bad limit or cursor with 400', async () => {
      const author = await createUserWithSession();
      const path = `/users/${author.username}/posts`;
      const badQueries: Record<string, string | number>[] = [
        { limit: 0 },
        { limit: 51 },
        { limit: 'abc' },
        { cursor: '' },
        { cursor: 'nope!' },
      ];
      for (const query of badQueries) {
        const res = await call('get', path, { token: author.token, query });
        expect(res.status).toBe(400);
      }
    });

    it('without a session returns 401', async () => {
      const author = await createUserWithSession();
      expect(
        (await call('get', `/users/${author.username}/posts`)).status,
      ).toBe(401);
    });

    it('postCount on GET /users/:username and PATCH /users/me follows creates and deletes', async () => {
      const me = await createUserWithSession();
      const viewer = await createUserWithSession();
      const posts = [
        await createPost(me, 'one'),
        await createPost(me, 'two'),
        await createPost(me, 'three'),
      ];
      await createPost(viewer, 'not mine');

      const profile = await call('get', `/users/${me.username}`, {
        token: viewer.token,
      });
      expect(profile.status).toBe(200);
      expect(profile.body.postCount).toBe(3);

      expect(
        (await call('delete', `/posts/${posts[1].id}`, { token: me.token }))
          .status,
      ).toBe(204);

      const after = await call('get', `/users/${me.username}`, {
        token: viewer.token,
      });
      expect(after.body.postCount).toBe(2);

      const patched = await call('patch', '/users/me', {
        token: me.token,
        body: { bio: 'counting' },
      });
      expect(patched.status).toBe(200);
      expect(patched.body.postCount).toBe(2);
      // The caller's own profile is the one place the email is returned.
      expect(patched.body.email).toBe(me.email);
    });
  });

  describe('likes', () => {
    it('PUT /posts/:id/like is idempotent: { liked: true, likeCount: 1 } twice', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'like me');

      for (let i = 0; i < 2; i++) {
        const res = await call('put', `/posts/${post.id}/like`, {
          token: me.token,
        });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ liked: true, likeCount: 1 });
      }
      expect(
        await app.get(PrismaService).like.count({ where: { postId: post.id } }),
      ).toBe(1);
    });

    it('DELETE /posts/:id/like is idempotent: { liked: false, likeCount: 0 } twice', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'unlike me');
      await call('put', `/posts/${post.id}/like`, { token: me.token });

      for (let i = 0; i < 2; i++) {
        const res = await call('delete', `/posts/${post.id}/like`, {
          token: me.token,
        });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ liked: false, likeCount: 0 });
      }
      expect((await getPost(me, post.id)).likedByMe).toBe(false);
    });

    it('two likers count 2 with per-viewer likedByMe in GET /posts/:id and /feed', async () => {
      const author = await createUserWithSession();
      const other = await createUserWithSession();
      const bystander = await createUserWithSession();
      const post = await createPost(author, 'popular');

      expect(
        (await call('put', `/posts/${post.id}/like`, { token: author.token }))
          .body,
      ).toEqual({ liked: true, likeCount: 1 });
      expect(
        (await call('put', `/posts/${post.id}/like`, { token: other.token }))
          .body,
      ).toEqual({ liked: true, likeCount: 2 });

      expect(await getPost(author, post.id)).toMatchObject({
        likeCount: 2,
        likedByMe: true,
      });
      expect(await getPost(other, post.id)).toMatchObject({
        likeCount: 2,
        likedByMe: true,
      });
      expect(await getPost(bystander, post.id)).toMatchObject({
        likeCount: 2,
        likedByMe: false,
      });
      const feed = await walk<PostJson>('/feed', author.token);
      expect(feed.items).toEqual([
        expect.objectContaining({ id: post.id, likeCount: 2, likedByMe: true }),
      ]);

      // Unliking by one viewer changes only their own state.
      expect(
        (
          await call('delete', `/posts/${post.id}/like`, {
            token: author.token,
          })
        ).body,
      ).toEqual({ liked: false, likeCount: 1 });
      const feedAfter = await walk<PostJson>('/feed', author.token);
      expect(feedAfter.items[0]).toMatchObject({
        likeCount: 1,
        likedByMe: false,
      });
      expect(await getPost(other, post.id)).toMatchObject({
        likeCount: 1,
        likedByMe: true,
      });
    });

    it('an unknown post returns 404 on PUT and DELETE', async () => {
      const me = await createUserWithSession();
      const id = randomUUID();
      expect(
        (await call('put', `/posts/${id}/like`, { token: me.token })).status,
      ).toBe(404);
      expect(
        (await call('delete', `/posts/${id}/like`, { token: me.token })).status,
      ).toBe(404);
    });

    it('without a session returns 401 on PUT and DELETE', async () => {
      const author = await createUserWithSession();
      const post = await createPost(author, 'x');
      expect((await call('put', `/posts/${post.id}/like`)).status).toBe(401);
      expect((await call('delete', `/posts/${post.id}/like`)).status).toBe(401);
    });

    it('from a foreign Origin returns 403 on PUT and DELETE, changing nothing', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'x');

      expect(
        (
          await call('put', `/posts/${post.id}/like`, {
            token: me.token,
            origin: FOREIGN_ORIGIN,
          })
        ).status,
      ).toBe(403);
      expect((await getPost(me, post.id)).likeCount).toBe(0);

      await call('put', `/posts/${post.id}/like`, { token: me.token });
      expect(
        (
          await call('delete', `/posts/${post.id}/like`, {
            token: me.token,
            origin: FOREIGN_ORIGIN,
          })
        ).status,
      ).toBe(403);
      expect(await getPost(me, post.id)).toMatchObject({
        likeCount: 1,
        likedByMe: true,
      });
    });

    it('10 concurrent identical PUTs store a single like', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'race');
      // Listen once up front: otherwise supertest starts a listener per
      // parallel request on the same server (MaxListeners warning).
      await app.listen(0);

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          call('put', `/posts/${post.id}/like`, { token: me.token }),
        ),
      );
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ liked: true, likeCount: 1 });
      }
      expect(
        await app.get(PrismaService).like.count({ where: { postId: post.id } }),
      ).toBe(1);
    });
  });

  describe('comments', () => {
    it('POST /posts/:id/comments returns 201 with exactly the comment fields, trimmed', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'discuss');

      const res = await call('post', `/posts/${post.id}/comments`, {
        token: me.token,
        body: { body: '  nice\npost  ', authorId: author.userId },
      });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body as object).sort()).toEqual(COMMENT_KEYS);
      expect(res.body).toEqual({
        id: expect.any(String),
        body: 'nice\npost',
        createdAt: expect.any(String),
        author: { username: me.username },
      });
      const row = await app.get(PrismaService).comment.findUniqueOrThrow({
        where: { id: (res.body as CommentJson).id },
      });
      expect(row.authorId).toBe(me.userId);
      expect(row.postId).toBe(post.id);
    });

    it('applies the 1–280 code-point body rule', async () => {
      const author = await createUserWithSession();
      const post = await createPost(author, 'rules');
      const path = `/posts/${post.id}/comments`;

      for (const body of ['', '   \n ', 'a'.repeat(281), '😀'.repeat(281), 123]) {
        const res = await call('post', path, {
          token: author.token,
          body: { body },
        });
        expect(res.status).toBe(400);
      }
      const emoji = await createComment(author, post.id, '😀'.repeat(280));
      expect(emoji.body).toBe('😀'.repeat(280));
      expect(
        await app
          .get(PrismaService)
          .comment.count({ where: { postId: post.id } }),
      ).toBe(1);
    });

    it('an unknown post returns 404 on list and create', async () => {
      const me = await createUserWithSession();
      const id = randomUUID();
      expect(
        (await call('get', `/posts/${id}/comments`, { token: me.token }))
          .status,
      ).toBe(404);
      expect(
        (
          await call('post', `/posts/${id}/comments`, {
            token: me.token,
            body: { body: 'hello?' },
          })
        ).status,
      ).toBe(404);
    });

    it('lists oldest first, paging across 27 comments with tied timestamps', async () => {
      const author = await createUserWithSession();
      const commenter = await createUserWithSession();
      const post = await createPost(author, 'busy thread');
      const other = await createPost(author, 'other thread');
      const prisma = app.get(PrismaService);
      const base = new Date(Date.now() - 60 * 60 * 1000);
      // Groups of 3 comments share a createdAt, alternating authors.
      await prisma.comment.createMany({
        data: Array.from({ length: 27 }, (_, i) => ({
          postId: post.id,
          authorId: i % 2 === 0 ? author.userId : commenter.userId,
          body: `comment ${i}`,
          createdAt: new Date(base.getTime() + Math.floor(i / 3) * 1000),
        })),
      });
      await prisma.comment.create({
        data: {
          postId: other.id,
          authorId: author.userId,
          body: 'elsewhere',
          createdAt: base,
        },
      });
      const rows = await prisma.comment.findMany({
        where: { postId: post.id },
        select: { id: true, createdAt: true },
      });
      const expected = rows.sort((a, b) => -newestFirst(a, b)).map((c) => c.id);

      const path = `/posts/${post.id}/comments`;
      const byLimit4 = await walk<CommentJson>(path, commenter.token, 4);
      expect(byLimit4.pageSizes).toEqual([4, 4, 4, 4, 4, 4, 3]);
      expect(byLimit4.items.map((c) => c.id)).toEqual(expected);
      for (const comment of byLimit4.items) {
        expect(Object.keys(comment).sort()).toEqual(COMMENT_KEYS);
        expect(Object.keys(comment.author)).toEqual(['username']);
      }

      const byDefault = await walk<CommentJson>(path, commenter.token);
      expect(byDefault.pageSizes).toEqual([20, 7]);
      expect(byDefault.items.map((c) => c.id)).toEqual(expected);

      // 27 = 3 * 9: the last full page already reports nextCursor null.
      const byLimit9 = await walk<CommentJson>(path, commenter.token, 9);
      expect(byLimit9.pageSizes).toEqual([9, 9, 9]);
      expect(byLimit9.items.map((c) => c.id)).toEqual(expected);

      const badQueries: Record<string, string | number>[] = [
        { limit: 0 },
        { limit: 51 },
        { cursor: '' },
      ];
      for (const query of badQueries) {
        const res = await call('get', path, { token: author.token, query });
        expect(res.status).toBe(400);
      }
    });

    it('is rate limited to 20 comments per minute per user; other users are unaffected', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'flood');
      for (let i = 0; i < 20; i++) {
        await createComment(me, post.id, `comment ${i}`);
      }
      const res = await call('post', `/posts/${post.id}/comments`, {
        token: me.token,
        body: { body: 'one too many' },
      });
      expect(res.status).toBe(429);
      expect(
        await app
          .get(PrismaService)
          .comment.count({ where: { postId: post.id } }),
      ).toBe(20);

      await createComment(author, post.id, 'still allowed');
    });

    it('deletes your own comment (204); someone else’s is 403; wrong post or missing is 404', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'thread');
      const otherPost = await createPost(author, 'other thread');
      const mine = await createComment(me, post.id, 'mine');
      const theirs = await createComment(author, post.id, 'theirs');

      expect(
        (
          await call('delete', `/posts/${post.id}/comments/${theirs.id}`, {
            token: me.token,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('delete', `/posts/${otherPost.id}/comments/${mine.id}`, {
            token: me.token,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call('delete', `/posts/${post.id}/comments/${randomUUID()}`, {
            token: me.token,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call('delete', `/posts/${post.id}/comments/${mine.id}`, {
            token: me.token,
            origin: FOREIGN_ORIGIN,
          })
        ).status,
      ).toBe(403);
      expect(
        (await call('delete', `/posts/${post.id}/comments/${mine.id}`)).status,
      ).toBe(401);

      const prisma = app.get(PrismaService);
      expect(await prisma.comment.count({ where: { postId: post.id } })).toBe(
        2,
      );

      const res = await call(
        'delete',
        `/posts/${post.id}/comments/${mine.id}`,
        { token: me.token },
      );
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(
        (
          await call('delete', `/posts/${post.id}/comments/${mine.id}`, {
            token: me.token,
          })
        ).status,
      ).toBe(404);

      const { items } = await walk<CommentJson>(
        `/posts/${post.id}/comments`,
        me.token,
      );
      expect(items.map((c) => c.id)).toEqual([theirs.id]);
    });

    it('commentCount on the post and the feed tracks creates and deletes', async () => {
      const author = await createUserWithSession();
      const me = await createUserWithSession();
      const post = await createPost(author, 'counted');

      const c1 = await createComment(me, post.id, 'one');
      await createComment(author, post.id, 'two');
      await createComment(me, post.id, 'three');
      expect((await getPost(me, post.id)).commentCount).toBe(3);
      let feed = await walk<PostJson>('/feed', author.token);
      expect(feed.items[0]).toMatchObject({ id: post.id, commentCount: 3 });

      expect(
        (
          await call('delete', `/posts/${post.id}/comments/${c1.id}`, {
            token: me.token,
          })
        ).status,
      ).toBe(204);
      expect((await getPost(author, post.id)).commentCount).toBe(2);
      feed = await walk<PostJson>('/feed', author.token);
      expect(feed.items[0]).toMatchObject({ id: post.id, commentCount: 2 });
    });

    it('without a session returns 401 on list and create; foreign Origin 403 on create', async () => {
      const author = await createUserWithSession();
      const post = await createPost(author, 'x');
      const path = `/posts/${post.id}/comments`;
      expect((await call('get', path)).status).toBe(401);
      expect(
        (await call('post', path, { body: { body: 'anon' } })).status,
      ).toBe(401);
      expect(
        (
          await call('post', path, {
            token: author.token,
            origin: FOREIGN_ORIGIN,
            body: { body: 'csrf' },
          })
        ).status,
      ).toBe(403);
      expect(
        await app
          .get(PrismaService)
          .comment.count({ where: { postId: post.id } }),
      ).toBe(0);
    });
  });
});
