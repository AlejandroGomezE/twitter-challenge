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

// E2e coverage of the follows module: follow/unfollow, followers/following
// lists and suggestions. Runs on the dedicated e2e.db (vitest.config.e2e.ts).
// beforeEach builds a fresh app, so the in-memory throttle counters never
// leak between tests; afterEach deletes every created user (their follows
// cascade).

const FRONTEND_ORIGIN = 'http://localhost:5173';
const FOREIGN_ORIGIN = 'http://evil.test';

const FOLLOW_USER_KEYS = ['bio', 'followsYou', 'isFollowing', 'username'];
const PAGE_KEYS = ['items', 'nextCursor'];

// Keys that must never appear in any response of this module.
const NEVER_EXPOSED_KEYS = new Set([
  'passwordHash',
  'tokenHash',
  'email',
  'id',
  'followerId',
  'followingId',
]);

type Method = 'get' | 'put' | 'delete';

interface FollowUserJson {
  username: string;
  bio: string | null;
  isFollowing: boolean;
  followsYou: boolean;
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
  // Omitted -> the trusted frontend origin.
  origin?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number>;
}

interface RecordedResponse {
  method: Method;
  path: string;
  body: unknown;
}

// Returns the dotted paths of every forbidden key found anywhere in `value`.
function findForbiddenKeys(value: unknown, at = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenKeys(item, `${at}[${index}]`),
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(NEVER_EXPOSED_KEYS.has(key) ? [`${at}.${key}`] : []),
      ...findForbiddenKeys(child, `${at}.${key}`),
    ]);
  }
  return [];
}

describe('Follows (e2e)', () => {
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

  // Serialization guard over every response received through `call`: no
  // id/email/secret key anywhere, and no test user's email or id in the text.
  function assertNoLeaks(): void {
    for (const { method, path, body } of responses) {
      const found = findForbiddenKeys(body);
      if (found.length > 0) {
        throw new Error(
          `${method.toUpperCase()} ${path} leaked ${found.join(', ')}`,
        );
      }
      const text = JSON.stringify(body ?? null);
      const leaked = [...createdEmails, ...createdUserIds].find((value) =>
        text.includes(value),
      );
      if (leaked) {
        throw new Error(
          `${method.toUpperCase()} ${path} leaked an email address or id`,
        );
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
    let req = request(app.getHttpServer())
      [method](path)
      .set('Origin', options.origin ?? FRONTEND_ORIGIN);
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

  async function follow(me: TestUser, target: TestUser): Promise<void> {
    const res = await call('put', `/users/${target.username}/follow`, {
      token: me.token,
    });
    expect(res.status).toBe(200);
  }

  function followCount(followerId: string, followingId: string) {
    return app
      .get(PrismaService)
      .follow.count({ where: { followerId, followingId } });
  }

  // Walks a cursor-paged listing to its end, asserting the page shape.
  async function walk(
    path: string,
    token: string,
    limit?: number,
  ): Promise<{ items: FollowUserJson[]; pageSizes: number[] }> {
    const items: FollowUserJson[] = [];
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
      const body = res.body as PageJson<FollowUserJson>;
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(FOLLOW_USER_KEYS);
      }
      items.push(...body.items);
      pageSizes.push(body.items.length);
      if (body.nextCursor === null) {
        return { items, pageSizes };
      }
      cursor = body.nextCursor;
    }
    throw new Error(`Pagination of ${path} did not terminate`);
  }

  describe('PUT/DELETE /users/:username/follow', () => {
    it('PUT is idempotent: { following: true, followerCount: 1 } twice, one row', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();

      for (let i = 0; i < 2; i++) {
        const res = await call('put', `/users/${target.username}/follow`, {
          token: me.token,
        });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ following: true, followerCount: 1 });
      }
      expect(await followCount(me.userId, target.userId)).toBe(1);
    });

    it('DELETE is idempotent: { following: false, followerCount: 0 } twice', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();
      await follow(me, target);

      for (let i = 0; i < 2; i++) {
        const res = await call('delete', `/users/${target.username}/follow`, {
          token: me.token,
        });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ following: false, followerCount: 0 });
      }
      expect(await followCount(me.userId, target.userId)).toBe(0);
    });

    it("followerCount is the target's total across followers; username is case-insensitive", async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const target = await createUserWithSession();
      await follow(a, target);

      const res = await call(
        'put',
        `/users/${target.username.toUpperCase()}/follow`,
        { token: b.token },
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: true, followerCount: 2 });
    });

    it('the target always comes from the path: body fields (even numeric) are ignored', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();
      const other = await createUserWithSession();

      const res = await call('put', `/users/${target.username}/follow`, {
        token: me.token,
        body: { username: 123, followerId: other.userId, followingId: 456 },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: true, followerCount: 1 });
      expect(await followCount(me.userId, target.userId)).toBe(1);
      expect(await followCount(other.userId, target.userId)).toBe(0);
    });

    it('following or unfollowing yourself is a 400', async () => {
      const me = await createUserWithSession();

      for (const method of ['put', 'delete'] as const) {
        const res = await call(method, `/users/${me.username}/follow`, {
          token: me.token,
        });
        expect(res.status).toBe(400);
      }
      expect(await followCount(me.userId, me.userId)).toBe(0);
    });

    it('an unknown or numeric-looking username is a 404 on PUT and DELETE', async () => {
      const me = await createUserWithSession();

      for (const name of ['nobody_here_xyz', '123', 'me']) {
        for (const method of ['put', 'delete'] as const) {
          const res = await call(method, `/users/${name}/follow`, {
            token: me.token,
          });
          expect(res.status).toBe(404);
          expect((res.body as { message: string }).message).toBe(
            'User not found',
          );
        }
      }
    });

    it('without a session is a 401; from a foreign Origin a 403 that changes nothing', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();

      for (const method of ['put', 'delete'] as const) {
        expect(
          (await call(method, `/users/${target.username}/follow`)).status,
        ).toBe(401);
      }
      expect(
        (
          await call('put', `/users/${target.username}/follow`, {
            token: me.token,
            origin: FOREIGN_ORIGIN,
          })
        ).status,
      ).toBe(403);
      expect(await followCount(me.userId, target.userId)).toBe(0);
    });

    it('10 concurrent identical PUTs store a single follow', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();
      // Listen once up front: otherwise supertest starts a listener per
      // parallel request on the same server (MaxListeners warning).
      await app.listen(0);

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          call('put', `/users/${target.username}/follow`, { token: me.token }),
        ),
      );
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ following: true, followerCount: 1 });
      }
      expect(await followCount(me.userId, target.userId)).toBe(1);
    });

    it('is rate limited to 30 per minute per user; other users are unaffected', async () => {
      const me = await createUserWithSession();
      const other = await createUserWithSession();
      const target = await createUserWithSession();

      for (let i = 0; i < 30; i++) {
        await follow(me, target);
      }
      const res = await call('put', `/users/${target.username}/follow`, {
        token: me.token,
      });
      expect(res.status).toBe(429);

      await follow(other, target);
    });
  });

  describe('GET /users/:username/followers and /following', () => {
    it('lists most recent follow first with booleans relative to the caller', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();
      const mutual = await createUserWithSession();
      const fan = await createUserWithSession();
      const followed = await createUserWithSession();
      // me <-> mutual; fan -> me; me -> followed.
      await follow(me, mutual);
      await follow(mutual, me);
      await follow(fan, me);
      await follow(me, followed);

      const prisma = app.get(PrismaService);
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      await prisma.follow.createMany({
        data: [followed, fan, me, mutual].map((follower, index) => ({
          followerId: follower.userId,
          followingId: target.userId,
          createdAt: new Date(base + index * 1000),
        })),
      });

      const { items } = await walk(
        `/users/${target.username}/followers`,
        me.token,
      );
      expect(items).toEqual([
        {
          username: mutual.username,
          bio: null,
          isFollowing: true,
          followsYou: true,
        },
        {
          username: me.username,
          bio: null,
          isFollowing: false,
          followsYou: false,
        },
        {
          username: fan.username,
          bio: null,
          isFollowing: false,
          followsYou: true,
        },
        {
          username: followed.username,
          bio: null,
          isFollowing: true,
          followsYou: false,
        },
      ]);

      const following = await walk(
        `/users/${me.username.toUpperCase()}/following`,
        me.token,
      );
      // Most recent follow first: followed, then mutual (plus the seeded
      // follow of target, which is older than both).
      expect(following.items.map((item) => item.username)).toEqual([
        followed.username,
        mutual.username,
        target.username,
      ]);
      expect(following.items[0]).toEqual({
        username: followed.username,
        bio: null,
        isFollowing: true,
        followsYou: false,
      });
    });

    it('walks 45 followers with tied timestamps exactly: no skips, no duplicates', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();
      const followers = await Promise.all(
        Array.from({ length: 45 }, () => createUserWithSession()),
      );
      const base = Date.parse('2026-02-01T00:00:00.000Z');
      await app.get(PrismaService).follow.createMany({
        data: followers.map((follower, index) => ({
          followerId: follower.userId,
          followingId: target.userId,
          createdAt: new Date(base + Math.floor(index / 4) * 1000),
        })),
      });

      const { items, pageSizes } = await walk(
        `/users/${target.username}/followers`,
        me.token,
        7,
      );
      expect(pageSizes).toEqual([7, 7, 7, 7, 7, 7, 3]);
      const names = items.map((item) => item.username);
      expect(new Set(names).size).toBe(45);
      expect(new Set(names)).toEqual(
        new Set(followers.map((follower) => follower.username)),
      );

      const firstPage = await call(
        'get',
        `/users/${target.username}/followers`,
        { token: me.token },
      );
      expect((firstPage.body as PageJson<FollowUserJson>).items).toHaveLength(
        20,
      );
    });

    it('a user without follows is an empty page', async () => {
      const me = await createUserWithSession();

      for (const list of ['followers', 'following']) {
        const res = await call('get', `/users/${me.username}/${list}`, {
          token: me.token,
        });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ items: [], nextCursor: null });
      }
    });

    it('an unknown user is a 404; `me` is not an alias', async () => {
      const me = await createUserWithSession();

      for (const name of ['nobody_here_xyz', 'me']) {
        for (const list of ['followers', 'following']) {
          const res = await call('get', `/users/${name}/${list}`, {
            token: me.token,
          });
          expect(res.status).toBe(404);
        }
      }
    });

    it('rejects a bad limit or cursor with 400', async () => {
      const me = await createUserWithSession();

      for (const query of [
        { limit: 0 },
        { limit: 51 },
        { limit: 'abc' },
        { cursor: 'not-a-cursor!' },
        { cursor: Buffer.from('["x","y"]').toString('base64url') },
      ]) {
        const res = await call('get', `/users/${me.username}/followers`, {
          token: me.token,
          query,
        });
        expect(res.status).toBe(400);
      }
      const invalid = await call('get', `/users/${me.username}/following`, {
        token: me.token,
        query: { cursor: 'zzz' },
      });
      expect(invalid.status).toBe(400);
      expect((invalid.body as { message: string }).message).toBe(
        'Invalid cursor',
      );
    });

    it('without a session is a 401', async () => {
      const target = await createUserWithSession();

      for (const list of ['followers', 'following']) {
        expect(
          (await call('get', `/users/${target.username}/${list}`)).status,
        ).toBe(401);
      }
    });
  });

  describe('GET /users/me/suggestions', () => {
    // The e2e DB may hold users from other suites; newest accounts come
    // first, so the users created last by this test lead the list.
    it('lists newest accounts first, excluding yourself and whoever you follow', async () => {
      const me = await createUserWithSession();
      const older = await createUserWithSession();
      const followed = await createUserWithSession();
      const fan = await createUserWithSession();
      const newest = await createUserWithSession();
      await follow(me, followed);
      await follow(fan, me);
      const prisma = app.get(PrismaService);
      const base = Date.now() + 60 * 60 * 1000;
      for (const [index, user] of [
        me,
        older,
        followed,
        fan,
        newest,
      ].entries()) {
        await prisma.user.update({
          where: { id: user.userId },
          data: { createdAt: new Date(base + index * 1000) },
        });
      }

      const res = await call('get', '/users/me/suggestions', {
        token: me.token,
      });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body as object)).toEqual(['items']);
      expect((res.body as { items: FollowUserJson[] }).items).toEqual([
        {
          username: newest.username,
          bio: null,
          isFollowing: false,
          followsYou: false,
        },
        {
          username: fan.username,
          bio: null,
          isFollowing: false,
          followsYou: true,
        },
        {
          username: older.username,
          bio: null,
          isFollowing: false,
          followsYou: false,
        },
      ]);

      const more = await call('get', '/users/me/suggestions', {
        token: me.token,
        query: { limit: 10 },
      });
      expect(more.status).toBe(200);
      const names = (more.body as { items: FollowUserJson[] }).items.map(
        (item) => item.username,
      );
      expect(names.length).toBeLessThanOrEqual(10);
      expect(names).not.toContain(me.username);
      expect(names).not.toContain(followed.username);
    });

    it('rejects a limit outside 1..10 with 400', async () => {
      const me = await createUserWithSession();

      for (const limit of [0, 11, 'abc', 2.5]) {
        const res = await call('get', '/users/me/suggestions', {
          token: me.token,
          query: { limit },
        });
        expect(res.status).toBe(400);
      }
    });

    it('does not shadow GET /users/:username or /users/:username/posts', async () => {
      const me = await createUserWithSession();
      const target = await createUserWithSession();

      const profile = await request(app.getHttpServer())
        .get(`/users/${target.username}`)
        .set('Cookie', `${SESSION_COOKIE}=${me.token}`);
      expect(profile.status).toBe(200);
      expect(profile.body).toMatchObject({ username: target.username });

      const posts = await request(app.getHttpServer())
        .get(`/users/${target.username}/posts`)
        .set('Cookie', `${SESSION_COOKIE}=${me.token}`);
      expect(posts.status).toBe(200);
      expect(posts.body).toEqual({ items: [], nextCursor: null });

      const meProfile = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', `${SESSION_COOKIE}=${me.token}`);
      expect(meProfile.status).toBe(404);
    });

    it('without a session is a 401', async () => {
      expect((await call('get', '/users/me/suggestions')).status).toBe(401);
    });
  });
});
