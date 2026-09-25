import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'supertest';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { SESSION_COOKIE } from './../src/auth/session.constants.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { runSeed, type SeedSummary } from './../src/database/seed/run-seed.js';
import {
  SEED_PASSWORD,
  buildSeedData,
} from './../src/database/seed/seed-data.js';

// E2e coverage of the seed: runSeed writes the full data set, and the app
// then serves it (sign in as demo, feed, notifications, search).
//
// runSeed wipes every user, post, follow, like, comment, notification and
// session. The other e2e files run in parallel against the shared
// backend/prisma/e2e.db (test/global-setup.ts), so seeding THAT file would
// delete their rows mid-test. This file therefore uses its own SQLite file,
// backend/prisma/e2e-seed.db (git-ignored by `/prisma/*.db*`): built fresh in
// beforeAll the same way global-setup builds e2e.db, pointed at via
// DATABASE_URL for this worker only (before PrismaService is constructed),
// and deleted in afterAll.

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SEED_DATABASE_URL = 'file:./e2e-seed.db';
const SEED_DB_FILE = path.join(BACKEND_DIR, 'prisma', 'e2e-seed.db');

const FRONTEND_ORIGIN = 'http://localhost:5173';
const DEMO_EMAIL = 'demo@example.com';

function removeDatabaseFiles(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${SEED_DB_FILE}${suffix}`, { force: true });
  }
}

function pushSchema(): void {
  execFileSync(
    process.execPath,
    [
      path.join(BACKEND_DIR, 'node_modules', 'prisma', 'build', 'index.js'),
      'db',
      'push',
    ],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: SEED_DATABASE_URL },
      stdio: 'pipe',
    },
  );
}

interface PageJson {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

describe('Seed (e2e)', () => {
  const data = buildSeedData();
  const expectedCounts = {
    users: data.users.length,
    posts: data.posts.length,
    follows: data.follows.length,
    likes: data.likes.length,
    comments: data.comments.length,
    notifications: data.notifications.length,
  };
  const expectedUnread = data.notifications.filter(
    (notification) => notification.readMinutesAgo === undefined,
  ).length;

  let app: INestApplication;
  let prisma: PrismaService;
  let firstSummary: SeedSummary;

  beforeAll(async () => {
    removeDatabaseFiles();
    pushSchema();
    vi.stubEnv('DATABASE_URL', SEED_DATABASE_URL);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    firstSummary = await runSeed(prisma);
  }, 60_000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      vi.unstubAllEnvs();
      removeDatabaseFiles();
    }
  });

  async function tableCounts(): Promise<typeof expectedCounts> {
    return {
      users: await prisma.user.count(),
      posts: await prisma.post.count(),
      follows: await prisma.follow.count(),
      likes: await prisma.like.count(),
      comments: await prisma.comment.count(),
      notifications: await prisma.notification.count(),
    };
  }

  async function signInAsDemo(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('Origin', FRONTEND_ORIGIN)
      .send({ email: DEMO_EMAIL, password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    return sessionToken(res);
  }

  // POST /auth/sign-in is rate limited (5 per minute per app), so the read
  // tests share one session; only the reseed test (which wipes sessions)
  // signs in again.
  let demoToken: string | undefined;
  async function demoSession(): Promise<string> {
    demoToken ??= await signInAsDemo();
    return demoToken;
  }

  function sessionToken(res: Response): string {
    const header: string[] | string | undefined = res.headers['set-cookie'];
    const cookies = Array.isArray(header) ? header : header ? [header] : [];
    const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) {
      throw new Error('No session cookie set');
    }
    return cookie.split(';')[0].slice(SESSION_COOKIE.length + 1);
  }

  function get(url: string, token: string): request.Test {
    return request(app.getHttpServer())
      .get(url)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', `${SESSION_COOKIE}=${token}`);
  }

  // Guard: this file must never seed the shared e2e.db (or the dev DB).
  it('runs against its own e2e-seed.db', async () => {
    const [main] = await prisma.$queryRawUnsafe<{ file: string }[]>(
      'PRAGMA database_list',
    );
    expect(path.basename(main.file)).toBe('e2e-seed.db');
  });

  it('writes the whole data set and reports matching counts', async () => {
    expect(firstSummary).toEqual({ skipped: false, ...expectedCounts });
    expect(expectedCounts.users).toBe(30);
    expect(await tableCounts()).toEqual(expectedCounts);
    expect(await prisma.session.count()).toBe(0);
  });

  it('lets demo sign in and see a paginated Following feed', async () => {
    const token = await demoSession();

    const res = await get('/feed', token);
    expect(res.status).toBe(200);
    const page = res.body as PageJson;
    expect(page.items.length).toBeGreaterThan(0);
    // demo follows 20 users with 5-8 posts each: more than one page.
    expect(page.nextCursor).toEqual(expect.any(String));

    const next = await get(
      `/feed?cursor=${encodeURIComponent(page.nextCursor!)}`,
      token,
    );
    expect(next.status).toBe(200);
    expect((next.body as PageJson).items.length).toBeGreaterThan(0);

    const forYou = await get('/feed/for-you', token);
    expect(forYou.status).toBe(200);
    expect((forYou.body as PageJson).items.length).toBeGreaterThan(0);
  });

  it('shows demo the seeded unread notifications', async () => {
    const token = await demoSession();

    const count = await get('/notifications/unread-count', token);
    expect(count.status).toBe(200);
    expect(count.body).toEqual({ count: expectedUnread });
    expect(expectedUnread).toBeGreaterThan(0);

    const list = await get('/notifications', token);
    expect(list.status).toBe(200);
    expect((list.body as PageJson).items).toHaveLength(
      expectedCounts.notifications,
    );
  });

  it('finds users when searching for "an"', async () => {
    const token = await demoSession();

    const res = await get('/search/users?q=an', token);
    expect(res.status).toBe(200);
    const page = res.body as PageJson;
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      const text = `${String(item.username)} ${String(item.displayName)}`;
      expect(text.toLowerCase()).toContain('an');
    }
  });

  it('re-running resets to the same data set, dropping extra rows and sessions', async () => {
    await demoSession();
    expect(await prisma.session.count()).toBeGreaterThan(0);
    await prisma.user.create({
      data: {
        email: 'extra@example.test',
        username: 'extra_user',
        displayName: 'Extra',
        passwordHash: 'x',
      },
    });

    const summary = await runSeed(prisma);

    expect(summary).toEqual({ skipped: false, ...expectedCounts });
    expect(await tableCounts()).toEqual(expectedCounts);
    expect(await prisma.session.count()).toBe(0);
    expect(
      await prisma.user.findUnique({ where: { username: 'extra_user' } }),
    ).toBeNull();
    // The documented credentials still work after a reseed.
    await signInAsDemo();
  });

  it('with ifEmpty, skips a database that already has users', async () => {
    const before = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const summary = await runSeed(prisma, { ifEmpty: true });

    expect(summary).toEqual({
      skipped: true,
      users: 0,
      posts: 0,
      follows: 0,
      likes: 0,
      comments: 0,
      notifications: 0,
    });
    // Same rows (ids are regenerated on every real seed, so this proves no reseed).
    expect(
      await prisma.user.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(await tableCounts()).toEqual(expectedCounts);
  });

  it('with ifEmpty, seeds an empty database', async () => {
    await prisma.$transaction([
      prisma.notification.deleteMany(),
      prisma.comment.deleteMany(),
      prisma.like.deleteMany(),
      prisma.follow.deleteMany(),
      prisma.post.deleteMany(),
      prisma.session.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    const summary = await runSeed(prisma, { ifEmpty: true });

    expect(summary).toEqual({ skipped: false, ...expectedCounts });
    expect(await tableCounts()).toEqual(expectedCounts);
  });
});
