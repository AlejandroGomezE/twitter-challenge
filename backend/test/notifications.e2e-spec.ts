import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Response } from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AuthService } from './../src/auth/auth.service.js';
import { SESSION_COOKIE } from './../src/auth/session.constants.js';
import { DomainEvent } from './../src/common/events/domain-events.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { NotificationsListener } from './../src/modules/notifications/notifications.listener.js';
import { UsersService } from './../src/modules/users/users.service.js';

// E2e coverage of the notifications module through the real HTTP + domain
// event path: follows, likes and comments (posts / follows modules) emit
// events, NotificationsListener writes the rows, and /notifications reads
// and marks them. Runs on the dedicated e2e.db (vitest.config.e2e.ts).
// beforeEach builds a fresh app, so the in-memory throttle counters never
// leak between tests; afterEach deletes every created user (their posts,
// follows, likes, comments and notifications cascade).
//
// The listeners are `@OnEvent(..., { async: true })`: a notification is
// written shortly AFTER the originating request returns. `settle()` waits
// until every domain event emitted so far has been fully handled by the
// listener, so both "it appeared" and "nothing appeared" assertions are
// deterministic (no fixed sleeps).

const FRONTEND_ORIGIN = 'http://localhost:5173';
const FOREIGN_ORIGIN = 'http://evil.test';

const PAGE_KEYS = ['items', 'nextCursor'];
const NOTIFICATION_KEYS = [
  'actor',
  'comment',
  'createdAt',
  'id',
  'post',
  'read',
  'type',
];
const ACTOR_KEYS = ['displayName', 'username'];
const SUBJECT_KEYS = ['body', 'id'];

// Display name the helper gives every user.
const DISPLAY_NAME = 'E2E User';

// Keys that must never appear in any response of this module.
const NEVER_EXPOSED_KEYS = new Set([
  'passwordHash',
  'tokenHash',
  'email',
  'recipientId',
  'actorId',
  'postId',
  'commentId',
  'readAt',
]);

// Listener handlers wrapped to count completed runs (see settle()).
const LISTENER_METHODS = [
  'onLikeCreated',
  'onLikeRemoved',
  'onFollowCreated',
  'onFollowRemoved',
  'onCommentCreated',
] as const;
const DOMAIN_EVENT_NAMES = new Set<string>(Object.values(DomainEvent));

const SETTLE_TIMEOUT_MS = 2000;
const SETTLE_INTERVAL_MS = 5;

type Method = 'get' | 'post' | 'put' | 'delete';

interface SubjectJson {
  id: string;
  body: string;
}

interface NotificationJson {
  id: string;
  type: 'follow' | 'like' | 'comment';
  createdAt: string;
  read: boolean;
  actor: { username: string; displayName: string | null };
  post: SubjectJson | null;
  comment: SubjectJson | null;
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

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  const createdUserIds: string[] = [];
  const createdEmails: string[] = [];
  const responses: RecordedResponse[] = [];
  let emitted = 0;
  let handled = 0;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    // Count domain events at emit time (onAny runs synchronously inside
    // emit(), i.e. before the originating request returns) and listener runs
    // on completion. The event-emitter loader looks the handler up on the
    // instance on every event, so wrapping the instance methods is enough.
    emitted = 0;
    handled = 0;
    app.get(EventEmitter2).onAny((event) => {
      if (typeof event === 'string' && DOMAIN_EVENT_NAMES.has(event)) {
        emitted++;
      }
    });
    const listener = app.get(NotificationsListener);
    for (const method of LISTENER_METHODS) {
      const original = listener[method].bind(listener) as (
        payload: never,
      ) => Promise<void>;
      (listener as unknown as Record<string, unknown>)[method] = async (
        payload: never,
      ): Promise<void> => {
        try {
          await original(payload);
        } finally {
          handled++;
        }
      };
    }
  });

  afterEach(async () => {
    try {
      assertNoLeaks();
    } finally {
      try {
        await settle();
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

  // Waits until every domain event emitted so far has been handled by
  // NotificationsListener (its notification written or retracted).
  async function settle(): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (handled < emitted) {
      if (Date.now() > deadline) {
        throw new Error(
          `Listener did not settle: ${handled}/${emitted} events handled`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
    }
  }

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
          `${method.toUpperCase()} ${path} leaked an email address or user id`,
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
      .create(email, uniqueUsername(), DISPLAY_NAME, 'correct-horse-battery');
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

  async function createPost(user: TestUser, body: string): Promise<SubjectJson> {
    const res = await call('post', '/posts', {
      token: user.token,
      body: { body },
    });
    expect(res.status).toBe(201);
    return res.body as SubjectJson;
  }

  async function createComment(
    user: TestUser,
    postId: string,
    body: string,
  ): Promise<SubjectJson> {
    const res = await call('post', `/posts/${postId}/comments`, {
      token: user.token,
      body: { body },
    });
    expect(res.status).toBe(201);
    return res.body as SubjectJson;
  }

  async function follow(me: TestUser, target: TestUser): Promise<void> {
    const res = await call('put', `/users/${target.username}/follow`, {
      token: me.token,
    });
    expect(res.status).toBe(200);
  }

  async function like(me: TestUser, postId: string): Promise<void> {
    const res = await call('put', `/posts/${postId}/like`, {
      token: me.token,
    });
    expect(res.status).toBe(200);
  }

  // The first page of `user`'s notifications, after every pending event has
  // been handled. Asserts the page and item shape.
  async function listNotifications(
    user: TestUser,
    query?: Record<string, string | number>,
  ): Promise<PageJson<NotificationJson>> {
    await settle();
    const res = await call('get', '/notifications', {
      token: user.token,
      query,
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object).sort()).toEqual(PAGE_KEYS);
    const page = res.body as PageJson<NotificationJson>;
    for (const item of page.items) {
      expectNotificationShape(item);
    }
    return page;
  }

  async function unreadCount(user: TestUser): Promise<number> {
    await settle();
    const res = await call('get', '/notifications/unread-count', {
      token: user.token,
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).toEqual(['count']);
    return (res.body as { count: number }).count;
  }

  function expectNotificationShape(item: NotificationJson): void {
    expect(Object.keys(item).sort()).toEqual(NOTIFICATION_KEYS);
    expect(Object.keys(item.actor).sort()).toEqual(ACTOR_KEYS);
    for (const subject of [item.post, item.comment]) {
      if (subject !== null) {
        expect(Object.keys(subject).sort()).toEqual(SUBJECT_KEYS);
      }
    }
    expect(typeof item.id).toBe('string');
    expect(typeof item.read).toBe('boolean');
    expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
  }

  function notificationCount(recipientId: string): Promise<number> {
    return app
      .get(PrismaService)
      .notification.count({ where: { recipientId } });
  }

  describe('creation from follows, likes and comments', () => {
    it('follow, like and comment by B each give A exactly one notification, newest first', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const post = await createPost(a, 'hello from A');

      await follow(b, a);
      await settle();
      await like(b, post.id);
      await settle();
      const comment = await createComment(b, post.id, 'nice post');

      const page = await listNotifications(a);
      // Harness self-check: settle() really tracked the three events.
      expect({ emitted, handled }).toEqual({ emitted: 3, handled: 3 });
      expect(page.nextCursor).toBeNull();
      const actor = { username: b.username, displayName: DISPLAY_NAME };
      expect(page.items).toEqual([
        {
          id: expect.any(String),
          type: 'comment',
          createdAt: expect.any(String),
          read: false,
          actor,
          post: { id: post.id, body: 'hello from A' },
          comment: { id: comment.id, body: 'nice post' },
        },
        {
          id: expect.any(String),
          type: 'like',
          createdAt: expect.any(String),
          read: false,
          actor,
          post: { id: post.id, body: 'hello from A' },
          comment: null,
        },
        {
          id: expect.any(String),
          type: 'follow',
          createdAt: expect.any(String),
          read: false,
          actor,
          post: null,
          comment: null,
        },
      ]);
      const times = page.items.map((item) => Date.parse(item.createdAt));
      expect([...times].sort((x, y) => y - x)).toEqual(times);
      expect(await unreadCount(a)).toBe(3);

      // B, the actor, has none.
      expect((await listNotifications(b)).items).toEqual([]);
      expect(await unreadCount(b)).toBe(0);
    });

    it('repeating the like or follow (idempotent PUT) creates no duplicate', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const post = await createPost(a, 'like me twice');

      for (let i = 0; i < 3; i++) {
        await follow(b, a);
        await like(b, post.id);
      }

      const page = await listNotifications(a);
      expect(page.items.map((item) => item.type).sort()).toEqual([
        'follow',
        'like',
      ]);
      expect(await notificationCount(a.userId)).toBe(2);
    });

    it('liking or commenting on your own post creates nothing', async () => {
      const a = await createUserWithSession();
      const post = await createPost(a, 'my own post');

      await like(a, post.id);
      await createComment(a, post.id, 'talking to myself');

      expect(await listNotifications(a)).toEqual({
        items: [],
        nextCursor: null,
      });
      expect(await unreadCount(a)).toBe(0);
      expect(await notificationCount(a.userId)).toBe(0);
    });
  });

  describe('removal', () => {
    it('unliking and unfollowing remove the like and follow notifications', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const post = await createPost(a, 'soon unliked');
      await follow(b, a);
      await like(b, post.id);
      expect((await listNotifications(a)).items).toHaveLength(2);

      const unliked = await call('delete', `/posts/${post.id}/like`, {
        token: b.token,
      });
      expect(unliked.status).toBe(200);
      expect(
        (await listNotifications(a)).items.map((item) => item.type),
      ).toEqual(['follow']);

      const unfollowed = await call('delete', `/users/${a.username}/follow`, {
        token: b.token,
      });
      expect(unfollowed.status).toBe(200);
      expect((await listNotifications(a)).items).toEqual([]);
      expect(await unreadCount(a)).toBe(0);
    });

    it('re-liking after an unlike gives a single fresh notification', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const post = await createPost(a, 'like, unlike, like');

      await like(b, post.id);
      await settle();
      await call('delete', `/posts/${post.id}/like`, { token: b.token });
      await settle();
      await like(b, post.id);

      const page = await listNotifications(a);
      expect(page.items.map((item) => item.type)).toEqual(['like']);
    });

    it('deleting the comment removes its notification (cascade)', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const post = await createPost(a, 'commented');
      const comment = await createComment(b, post.id, 'to be deleted');
      expect(
        (await listNotifications(a)).items.map((item) => item.type),
      ).toEqual(['comment']);

      const res = await call(
        'delete',
        `/posts/${post.id}/comments/${comment.id}`,
        { token: b.token },
      );
      expect(res.status).toBe(204);
      expect((await listNotifications(a)).items).toEqual([]);
    });

    it("deleting the post removes its like and comment notifications but keeps the follow", async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const post = await createPost(a, 'to be deleted');
      await follow(b, a);
      await like(b, post.id);
      await createComment(b, post.id, 'on a doomed post');
      expect((await listNotifications(a)).items).toHaveLength(3);

      const res = await call('delete', `/posts/${post.id}`, {
        token: a.token,
      });
      expect(res.status).toBe(204);
      expect(
        (await listNotifications(a)).items.map((item) => item.type),
      ).toEqual(['follow']);
      expect(await unreadCount(a)).toBe(1);
    });
  });

  describe('GET /notifications/unread-count and POST /notifications/read', () => {
    it('marks only notifications created up to `until` as read (204); a later one stays unread', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const c = await createUserWithSession();
      await follow(b, a);
      await settle();
      // Push the first notification a minute into the past so the later one
      // is strictly newer than `until` regardless of clock resolution.
      const prisma = app.get(PrismaService);
      await prisma.notification.updateMany({
        where: { recipientId: a.userId },
        data: { createdAt: new Date(Date.now() - 60_000) },
      });
      const [seen] = (await listNotifications(a)).items;
      expect(await unreadCount(a)).toBe(1);

      // Arrives after the client loaded its page.
      await follow(c, a);
      expect(await unreadCount(a)).toBe(2);

      const res = await call('post', '/notifications/read', {
        token: a.token,
        body: { until: seen.createdAt },
      });
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      expect(await unreadCount(a)).toBe(1);
      const page = await listNotifications(a);
      expect(
        page.items.map((item) => [item.actor.username, item.read]),
      ).toEqual([
        [c.username, false],
        [b.username, true],
      ]);

      // Marking up to now reads the rest; repeating it is harmless.
      for (let i = 0; i < 2; i++) {
        const all = await call('post', '/notifications/read', {
          token: a.token,
          body: { until: new Date().toISOString() },
        });
        expect(all.status).toBe(204);
      }
      expect(await unreadCount(a)).toBe(0);
      expect(
        (await listNotifications(a)).items.every((item) => item.read),
      ).toBe(true);
    });

    it('rejects a missing or invalid `until` with 400 and marks nothing', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      await follow(b, a);
      expect(await unreadCount(a)).toBe(1);

      for (const body of [
        undefined,
        {},
        { until: 'yesterday' },
        { until: '' },
        { until: 123 },
        { until: '2026-02-30T00:00:00.000Z' },
      ]) {
        const res = await call('post', '/notifications/read', {
          token: a.token,
          body,
        });
        expect(res.status).toBe(400);
      }
      expect(await unreadCount(a)).toBe(1);
    });

    it("marking read only touches the caller's own notifications", async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      await follow(b, a);
      await follow(a, b);
      expect(await unreadCount(a)).toBe(1);
      expect(await unreadCount(b)).toBe(1);

      const res = await call('post', '/notifications/read', {
        token: b.token,
        body: { until: new Date().toISOString() },
      });
      expect(res.status).toBe(204);
      expect(await unreadCount(b)).toBe(0);
      expect(await unreadCount(a)).toBe(1);
    });
  });

  describe('paging', () => {
    it('walks 25 notifications with tied timestamps by limit + nextCursor: no skips, no duplicates', async () => {
      const a = await createUserWithSession();
      const actors = await Promise.all(
        Array.from({ length: 25 }, () => createUserWithSession()),
      );
      const base = Date.parse('2026-03-01T00:00:00.000Z');
      await app.get(PrismaService).notification.createMany({
        data: actors.map((actor, index) => ({
          type: 'follow',
          recipientId: a.userId,
          actorId: actor.userId,
          createdAt: new Date(base + Math.floor(index / 3) * 1000),
        })),
      });

      const ids: string[] = [];
      const names: string[] = [];
      const pageSizes: number[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const query: Record<string, string | number> = { limit: 7 };
        if (cursor !== undefined) {
          query.cursor = cursor;
        }
        const body = await listNotifications(a, query);
        ids.push(...body.items.map((item) => item.id));
        names.push(...body.items.map((item) => item.actor.username));
        pageSizes.push(body.items.length);
        if (body.nextCursor === null) {
          break;
        }
        expect(typeof body.nextCursor).toBe('string');
        cursor = body.nextCursor;
      }
      expect(pageSizes).toEqual([7, 7, 7, 4]);
      expect(new Set(ids).size).toBe(25);
      expect(new Set(names)).toEqual(
        new Set(actors.map((actor) => actor.username)),
      );

      // Default page size is 20.
      const first = await listNotifications(a);
      expect(first.items).toHaveLength(20);
      expect(typeof first.nextCursor).toBe('string');
    });

    it('rejects a bad limit or cursor with 400', async () => {
      const a = await createUserWithSession();

      for (const query of [
        { limit: 0 },
        { limit: 51 },
        { limit: 'abc' },
        { cursor: 'not-a-cursor!' },
        { cursor: Buffer.from('["x","y"]').toString('base64url') },
      ]) {
        const res = await call('get', '/notifications', {
          token: a.token,
          query,
        });
        expect(res.status).toBe(400);
      }
      const invalid = await call('get', '/notifications', {
        token: a.token,
        query: { cursor: 'zzz' },
      });
      expect(invalid.status).toBe(400);
      expect((invalid.body as { message: string }).message).toBe(
        'Invalid cursor',
      );
    });
  });

  describe('auth', () => {
    it('without a session every route is a 401', async () => {
      expect((await call('get', '/notifications')).status).toBe(401);
      expect((await call('get', '/notifications/unread-count')).status).toBe(
        401,
      );
      expect(
        (
          await call('post', '/notifications/read', {
            body: { until: new Date().toISOString() },
          })
        ).status,
      ).toBe(401);
    });

    it('POST /notifications/read from a foreign Origin is a 403 that marks nothing', async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      await follow(b, a);
      expect(await unreadCount(a)).toBe(1);

      const res = await call('post', '/notifications/read', {
        token: a.token,
        origin: FOREIGN_ORIGIN,
        body: { until: new Date().toISOString() },
      });
      expect(res.status).toBe(403);
      expect(await unreadCount(a)).toBe(1);
    });

    it("B never sees A's notifications", async () => {
      const a = await createUserWithSession();
      const b = await createUserWithSession();
      const c = await createUserWithSession();
      const post = await createPost(a, 'only for A');
      await follow(c, a);
      await like(c, post.id);
      await createComment(c, post.id, 'hi A');
      await like(b, post.id);

      expect((await listNotifications(a)).items).toHaveLength(4);
      expect(await listNotifications(b)).toEqual({
        items: [],
        nextCursor: null,
      });
      expect(await unreadCount(b)).toBe(0);
    });
  });
});
