import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { AuthService } from './../src/auth/auth.service.js';
import { SESSION_COOKIE } from './../src/auth/session.constants.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { UsersService } from './../src/modules/users/users.service.js';

// E2e coverage of GET /search/users. Runs on the dedicated e2e.db
// (vitest.config.e2e.ts), which other e2e files share in parallel, so every
// test searches for a fresh random token that only its own users contain.
// The token starts with `k` (not a hex digit), so it can't appear inside the
// random hex usernames other suites create. afterEach deletes every created
// user (their follows and sessions cascade).

const FRONTEND_ORIGIN = 'http://localhost:5173';

const FOLLOW_USER_KEYS = [
  'bio',
  'displayName',
  'followsYou',
  'isFollowing',
  'username',
];
const PAGE_KEYS = ['items', 'nextCursor'];

// Keys that must never appear in any response of this endpoint.
const NEVER_EXPOSED_KEYS = new Set([
  'passwordHash',
  'tokenHash',
  'email',
  'id',
  'followerId',
  'followingId',
]);

interface FollowUserJson {
  username: string;
  displayName: string | null;
  bio: string | null;
  isFollowing: boolean;
  followsYou: boolean;
}

interface PageJson {
  items: FollowUserJson[];
  nextCursor: string | null;
}

interface TestUser {
  userId: string;
  username: string;
  email: string;
  token: string;
}

interface RecordedResponse {
  url: string;
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

// `k` + 7 hex chars: unique per test, lowercase (usernames are stored
// lowercase), and short enough to leave room in a 20-char username.
function newToken(): string {
  return `k${randomBytes(4).toString('hex').slice(0, 7)}`;
}

// A username that never contains a search token (hex only after `e2e_`).
function unrelatedUsername(): string {
  return `e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function usernamesOf(body: unknown): string[] {
  return (body as PageJson).items.map((item) => item.username);
}

describe('Search (e2e)', () => {
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

  // Serialization guard over every response received through `search`: no
  // id/email/secret key anywhere, and no test user's email or id in the text.
  function assertNoLeaks(): void {
    for (const { url, body } of responses) {
      const found = findForbiddenKeys(body);
      if (found.length > 0) {
        throw new Error(`GET ${url} leaked ${found.join(', ')}`);
      }
      const text = JSON.stringify(body ?? null);
      const leaked = [...createdEmails, ...createdUserIds].find((value) =>
        text.includes(value),
      );
      if (leaked) {
        throw new Error(`GET ${url} leaked an email address or id`);
      }
    }
  }

  async function createUser(
    username: string,
    displayName: string,
  ): Promise<TestUser> {
    const email = `e2e-${randomUUID()}@example.test`;
    const user = await app
      .get(UsersService)
      .create(email, username, displayName, 'correct-horse-battery');
    createdUserIds.push(user.id);
    createdEmails.push(email);
    const { token } = await app.get(AuthService).createSession(user.id);
    return { userId: user.id, username: user.username, email, token };
  }

  // Many users at once, straight through Prisma (no password hashing): only
  // used as search results, never signed in.
  async function createBulkUsers(usernames: string[]): Promise<void> {
    const prisma = app.get(PrismaService);
    for (const username of usernames) {
      const email = `e2e-${randomUUID()}@example.test`;
      const user = await prisma.user.create({
        data: { email, username, displayName: 'Bulk', passwordHash: 'x' },
        select: { id: true },
      });
      createdUserIds.push(user.id);
      createdEmails.push(email);
    }
  }

  // GET /search/users with a raw query string (so empty and repeated params
  // can be sent as-is); records the body for the serialization guard.
  async function search(query: string, token?: string): Promise<Response> {
    const url = `/search/users?${query}`;
    let req = request(app.getHttpServer())
      .get(url)
      .set('Origin', FRONTEND_ORIGIN);
    if (token) {
      req = req.set('Cookie', `${SESSION_COOKIE}=${token}`);
    }
    const res = await req;
    responses.push({ url, body: res.body as unknown });
    return res;
  }

  function q(value: string): string {
    return `q=${encodeURIComponent(value)}`;
  }

  async function searchOk(query: string, token: string): Promise<PageJson> {
    const res = await search(query, token);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object).sort()).toEqual(PAGE_KEYS);
    const body = res.body as PageJson;
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(FOLLOW_USER_KEYS);
    }
    return body;
  }

  async function follow(me: TestUser, target: TestUser): Promise<void> {
    const res = await request(app.getHttpServer())
      .put(`/users/${target.username}/follow`)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE}=${me.token}`);
    expect(res.status).toBe(200);
  }

  // Walks the search to its end, asserting the page shape.
  async function walk(
    text: string,
    token: string,
    limit: number,
  ): Promise<{ usernames: string[]; pageSizes: number[] }> {
    const usernames: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const cursorParam: string =
        cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const body = await searchOk(
        `${q(text)}&limit=${limit}${cursorParam}`,
        token,
      );
      usernames.push(...body.items.map((item) => item.username));
      pageSizes.push(body.items.length);
      if (body.nextCursor === null) {
        return { usernames, pageSizes };
      }
      cursor = body.nextCursor;
    }
    throw new Error('Search pagination did not terminate');
  }

  describe('matching', () => {
    it('matches on username and on display name, ordered by username; other users are left out', async () => {
      const tok = newToken();
      const me = await createUser(unrelatedUsername(), 'Searcher');
      const byUsername = await createUser(`${tok}_user`, 'Plain Name');
      const byDisplayName = await createUser(
        unrelatedUsername(),
        `Ada ${tok} Lovelace`,
      );
      await createUser(unrelatedUsername(), 'Nobody Special');

      const body = await searchOk(q(tok), me.token);

      expect(body.nextCursor).toBeNull();
      expect(usernamesOf(body)).toEqual(
        [byUsername.username, byDisplayName.username].sort(),
      );
      expect(body.items).toContainEqual({
        username: byDisplayName.username,
        displayName: `Ada ${tok} Lovelace`,
        bio: null,
        isFollowing: false,
        followsYou: false,
      });
    });

    it('is case-insensitive for ASCII in both directions', async () => {
      const tok = newToken();
      const me = await createUser(unrelatedUsername(), 'Searcher');
      const byUsername = await createUser(`${tok}_case`, 'Plain');
      const byDisplayName = await createUser(
        unrelatedUsername(),
        `Shouty ${tok.toUpperCase()}`,
      );
      const expected = [byUsername.username, byDisplayName.username].sort();

      for (const text of [
        tok,
        tok.toUpperCase(),
        `${tok[0].toUpperCase()}${tok.slice(1)}`,
      ]) {
        expect(usernamesOf(await searchOk(q(text), me.token))).toEqual(
          expected,
        );
      }
    });

    it('trims the query and strips one leading @', async () => {
      const tok = newToken();
      const me = await createUser(unrelatedUsername(), 'Searcher');
      const target = await createUser(`${tok}_at`, 'Plain');

      for (const text of [`@${tok}`, `  @${tok}  `, `@${tok}_at`]) {
        expect(usernamesOf(await searchOk(q(text), me.token))).toEqual([
          target.username,
        ]);
      }
    });

    it('matches % and _ literally, not as LIKE wildcards', async () => {
      const tok = newToken();
      const me = await createUser(unrelatedUsername(), 'Searcher');
      // `_` would match the `x` of this one if it were a wildcard.
      await createUser(`${tok}xa`, 'Plain');
      const underscore = await createUser(`${tok}_b`, 'Plain');
      const percent = await createUser(unrelatedUsername(), `${tok}%off`);

      expect(usernamesOf(await searchOk(q(`${tok}_`), me.token))).toEqual([
        underscore.username,
      ]);
      expect(usernamesOf(await searchOk(q(`${tok}%`), me.token))).toEqual([
        percent.username,
      ]);
    });

    it('includes the caller when they match, with both booleans false', async () => {
      const tok = newToken();
      const me = await createUser(`${tok}_me`, 'Me Myself');
      const other = await createUser(`${tok}_other`, 'Other');
      await follow(me, other);
      await follow(other, me);

      const body = await searchOk(q(tok), me.token);

      expect(body.items).toContainEqual({
        username: me.username,
        displayName: 'Me Myself',
        bio: null,
        isFollowing: false,
        followsYou: false,
      });
    });

    it('computes isFollowing and followsYou relative to the caller', async () => {
      const tok = newToken();
      const me = await createUser(unrelatedUsername(), 'Searcher');
      const followed = await createUser(`${tok}_a`, 'A');
      const mutual = await createUser(`${tok}_b`, 'B');
      const follower = await createUser(`${tok}_c`, 'C');
      const stranger = await createUser(`${tok}_d`, 'D');
      await follow(me, followed);
      await follow(me, mutual);
      await follow(mutual, me);
      await follow(follower, me);
      // A follow between two other users says nothing about the caller.
      await follow(stranger, followed);

      const body = await searchOk(q(tok), me.token);

      expect(
        body.items.map(({ username, isFollowing, followsYou }) => ({
          username,
          isFollowing,
          followsYou,
        })),
      ).toEqual([
        { username: followed.username, isFollowing: true, followsYou: false },
        { username: mutual.username, isFollowing: true, followsYou: true },
        { username: follower.username, isFollowing: false, followsYou: true },
        { username: stranger.username, isFollowing: false, followsYou: false },
      ]);
    });
  });

  describe('paging', () => {
    it('walks every match once, in username order, without duplicates or skips', async () => {
      const tok = newToken();
      const me = await createUser(unrelatedUsername(), 'Searcher');
      const expected = ['e', 'a', 'd', 'b', 'c'].map((s) => `${tok}_${s}`);
      await createBulkUsers(expected);

      const { usernames, pageSizes } = await walk(tok, me.token, 2);

      expect(usernames).toEqual([...expected].sort());
      expect(pageSizes).toEqual([2, 2, 1]);
    });

    it('defaults to 20 per page and allows up to 50', async () => {
      const tok = newToken();
      const me = await createUser(unrelatedUsername(), 'Searcher');
      await createBulkUsers(
        Array.from(
          { length: 21 },
          (_, index) => `${tok}_${String(index).padStart(2, '0')}`,
        ),
      );

      const first = await searchOk(q(tok), me.token);
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();

      const all = await searchOk(`${q(tok)}&limit=50`, me.token);
      expect(all.items).toHaveLength(21);
      expect(all.nextCursor).toBeNull();

      const one = await searchOk(`${q(tok)}&limit=1`, me.token);
      expect(one.items).toHaveLength(1);
    });

    it.each(['0', '51', '2.5', 'abc', ''])(
      'rejects limit=%j with 400',
      async (limit) => {
        const me = await createUser(unrelatedUsername(), 'Searcher');

        const res = await search(`q=a&limit=${limit}`, me.token);
        expect(res.status).toBe(400);
      },
    );
  });

  describe('bad requests and auth', () => {
    it.each([
      ['missing', ''],
      ['empty', 'q='],
      ['blank', q('   ')],
      ['@-only', q('@')],
      ['padded @-only', q('  @ ')],
      ['too long', q('a'.repeat(51))],
      ['repeated', 'q=a&q=b'],
    ])('rejects a %s q with 400', async (_label, query) => {
      const me = await createUser(unrelatedUsername(), 'Searcher');

      const res = await search(query, me.token);
      expect(res.status).toBe(400);
    });

    it('accepts 50 code points of emoji', async () => {
      const me = await createUser(unrelatedUsername(), 'Searcher');

      const body = await searchOk(q('\u{1F600}'.repeat(50)), me.token);
      expect(body.items).toEqual([]);
    });

    it.each([
      ['garbage', 'cursor=not!a!cursor'],
      ['empty', 'cursor='],
      [
        'a post cursor',
        `cursor=${Buffer.from(
          JSON.stringify(['2026-09-24T10:00:00.000Z', 'post-1']),
          'utf8',
        ).toString('base64url')}`,
      ],
    ])(
      'rejects a %s cursor with 400 Invalid cursor',
      async (_label, cursor) => {
        const me = await createUser(unrelatedUsername(), 'Searcher');

        const res = await search(`q=a&${cursor}`, me.token);
        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toBe(
          'Invalid cursor',
        );
      },
    );

    it('is 401 without a session', async () => {
      const res = await search('q=a');
      expect(res.status).toBe(401);
    });
  });
});
