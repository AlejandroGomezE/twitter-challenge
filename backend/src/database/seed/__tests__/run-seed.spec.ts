import * as argon2 from 'argon2';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { ARGON2_OPTIONS } from '../../../modules/users/users.service.js';
import { runSeed } from '../run-seed.js';
import { SEED_PASSWORD, buildSeedData } from '../seed-data.js';

// argon2.hash is wrapped (still the real implementation) so the test can
// count calls and check the options, then verify the produced hash for real.
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, hash: vi.fn(actual.hash) };
});

const MODELS = [
  'notification',
  'comment',
  'like',
  'follow',
  'post',
  'session',
  'user',
] as const;
type Model = (typeof MODELS)[number];

// Row payloads passed to createMany, keyed by model.
type Rows = Record<string, unknown>[];

interface FakePrisma {
  client: PrismaClient;
  // Every tx call in order, e.g. "notification.deleteMany".
  calls: string[];
  created: Partial<Record<Model, Rows>>;
  userCount: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  outsideWrites: ReturnType<typeof vi.fn>;
}

// A hand-rolled Prisma double: top-level `user.count` + `$transaction(fn)`;
// the transaction client records every deleteMany/createMany in order and
// answers createMany with `{ count: rows.length }`, like Prisma does.
function fakePrisma(existingUsers: number): FakePrisma {
  const calls: string[] = [];
  const created: Partial<Record<Model, Rows>> = {};

  const tx = Object.fromEntries(
    MODELS.map((model) => [
      model,
      {
        deleteMany: vi.fn(async () => {
          calls.push(`${model}.deleteMany`);
          return { count: 0 };
        }),
        createMany: vi.fn(async ({ data }: { data: Rows }) => {
          calls.push(`${model}.createMany`);
          created[model] = data;
          return { count: data.length };
        }),
      },
    ]),
  );

  const userCount = vi.fn(async () => existingUsers);
  const transaction = vi.fn(
    async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  );
  // Any write on the top-level client (outside the transaction) is a bug.
  const outsideWrites = vi.fn();
  const topLevel = Object.fromEntries(
    MODELS.map((model) => [
      model,
      {
        deleteMany: outsideWrites,
        createMany: outsideWrites,
        ...(model === 'user' ? { count: userCount } : {}),
      },
    ]),
  );

  return {
    client: { ...topLevel, $transaction: transaction } as unknown as PrismaClient,
    calls,
    created,
    userCount,
    transaction,
    outsideWrites,
  };
}

const NOW = new Date('2026-09-25T12:00:00.000Z');
const minutesBefore = (minutes: number): Date =>
  new Date(NOW.getTime() - minutes * 60_000);

describe('runSeed', () => {
  const data = buildSeedData();
  const hash = vi.mocked(argon2.hash);

  beforeEach(() => {
    hash.mockClear();
  });

  describe('with ifEmpty', () => {
    it('returns a skipped summary and writes nothing when users exist', async () => {
      const prisma = fakePrisma(3);

      const summary = await runSeed(prisma.client, { ifEmpty: true });

      expect(summary).toEqual({
        skipped: true,
        users: 0,
        posts: 0,
        follows: 0,
        likes: 0,
        comments: 0,
        notifications: 0,
      });
      expect(prisma.userCount).toHaveBeenCalledTimes(1);
      expect(prisma.transaction).not.toHaveBeenCalled();
      expect(prisma.outsideWrites).not.toHaveBeenCalled();
      expect(hash).not.toHaveBeenCalled();
    });

    it('seeds normally when the database has no users', async () => {
      const prisma = fakePrisma(0);

      const summary = await runSeed(prisma.client, { ifEmpty: true, now: NOW });

      expect(summary.skipped).toBe(false);
      expect(summary.users).toBe(30);
      expect(prisma.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('a full run', () => {
    let prisma: FakePrisma;
    let summary: Awaited<ReturnType<typeof runSeed>>;
    // Captured here: the outer beforeEach clears the mock before each test.
    let hashCalls: unknown[][];

    beforeAll(async () => {
      hash.mockClear();
      prisma = fakePrisma(7);
      summary = await runSeed(prisma.client, { now: NOW });
      hashCalls = [...hash.mock.calls];
    });

    it('does not check for existing users without ifEmpty', () => {
      expect(prisma.userCount).not.toHaveBeenCalled();
    });

    it('runs everything in one transaction, never on the top-level client', () => {
      expect(prisma.transaction).toHaveBeenCalledTimes(1);
      expect(prisma.transaction.mock.calls[0][1]).toEqual({
        timeout: expect.any(Number),
      });
      expect(prisma.outsideWrites).not.toHaveBeenCalled();
    });

    it('wipes children before parents, then inserts parents before children', () => {
      expect(prisma.calls).toEqual([
        'notification.deleteMany',
        'comment.deleteMany',
        'like.deleteMany',
        'follow.deleteMany',
        'post.deleteMany',
        'session.deleteMany',
        'user.deleteMany',
        'user.createMany',
        'post.createMany',
        'follow.createMany',
        'like.createMany',
        'comment.createMany',
        'notification.createMany',
      ]);
    });

    it('hashes the seed password once, with the sign-up options, and gives every user that hash', async () => {
      expect(hashCalls).toEqual([[SEED_PASSWORD, ARGON2_OPTIONS]]);

      const users = prisma.created.user!;
      const hashes = new Set(users.map((user) => user.passwordHash));
      expect(hashes.size).toBe(1);
      const [passwordHash] = hashes as Set<string>;
      expect(passwordHash).toMatch(/^\$argon2id\$/);
      await expect(argon2.verify(passwordHash, SEED_PASSWORD)).resolves.toBe(
        true,
      );
    });

    it('returns counts matching the rows inserted', () => {
      expect(summary).toEqual({
        skipped: false,
        users: prisma.created.user!.length,
        posts: prisma.created.post!.length,
        follows: prisma.created.follow!.length,
        likes: prisma.created.like!.length,
        comments: prisma.created.comment!.length,
        notifications: prisma.created.notification!.length,
      });
      expect(summary).toMatchObject({
        users: data.users.length,
        posts: data.posts.length,
        follows: data.follows.length,
        likes: data.likes.length,
        comments: data.comments.length,
        notifications: data.notifications.length,
      });
    });

    it('writes user rows from the seed data, with timestamps relative to now', () => {
      const users = prisma.created.user!;
      expect(users).toHaveLength(data.users.length);
      for (const [index, seedUser] of data.users.entries()) {
        expect(users[index]).toMatchObject({
          id: expect.any(String),
          email: seedUser.email,
          username: seedUser.username,
          displayName: seedUser.displayName,
          bio: seedUser.bio,
          createdAt: minutesBefore(seedUser.minutesAgo),
        });
      }
      expect(new Set(users.map((user) => user.id)).size).toBe(users.length);
    });

    it('wires every relation to an inserted id', () => {
      const userIds = new Map(
        prisma.created.user!.map((user) => [user.username, user.id]),
      );
      const postIds = new Map(
        data.posts.map((post, index) => [
          post.key,
          prisma.created.post![index].id,
        ]),
      );
      const commentIds = new Map(
        data.comments.map((comment, index) => [
          comment.key,
          prisma.created.comment![index].id,
        ]),
      );

      data.posts.forEach((post, index) => {
        expect(prisma.created.post![index]).toEqual({
          id: expect.any(String),
          authorId: userIds.get(post.author),
          body: post.body,
          createdAt: minutesBefore(post.minutesAgo),
        });
      });
      data.follows.forEach((follow, index) => {
        expect(prisma.created.follow![index]).toEqual({
          followerId: userIds.get(follow.follower),
          followingId: userIds.get(follow.following),
          createdAt: minutesBefore(follow.minutesAgo),
        });
      });
      data.likes.forEach((like, index) => {
        expect(prisma.created.like![index]).toEqual({
          userId: userIds.get(like.username),
          postId: postIds.get(like.postKey),
          createdAt: minutesBefore(like.minutesAgo),
        });
      });
      data.comments.forEach((comment, index) => {
        expect(prisma.created.comment![index]).toEqual({
          id: commentIds.get(comment.key),
          postId: postIds.get(comment.postKey),
          authorId: userIds.get(comment.author),
          body: comment.body,
          createdAt: minutesBefore(comment.minutesAgo),
        });
      });
      data.notifications.forEach((notification, index) => {
        expect(prisma.created.notification![index]).toEqual({
          recipientId: userIds.get(notification.recipient),
          actorId: userIds.get(notification.actor),
          type: notification.type,
          postId: notification.postKey
            ? postIds.get(notification.postKey)
            : null,
          commentId: notification.commentKey
            ? commentIds.get(notification.commentKey)
            : null,
          readAt:
            notification.readMinutesAgo === undefined
              ? null
              : minutesBefore(notification.readMinutesAgo),
          createdAt: minutesBefore(notification.minutesAgo),
        });
      });
      // Some notifications stay unread, some are read.
      const readAts = prisma.created.notification!.map((n) => n.readAt);
      expect(readAts).toContain(null);
      expect(readAts.some((readAt) => readAt instanceof Date)).toBe(true);
    });
  });

  it('propagates a failure inside the transaction', async () => {
    const prisma = fakePrisma(0);
    prisma.transaction.mockRejectedValueOnce(new Error('disk full'));

    await expect(runSeed(prisma.client, { now: NOW })).rejects.toThrow(
      'disk full',
    );
  });

  it('defaults `now` to the current time', async () => {
    const prisma = fakePrisma(0);
    const before = Date.now();

    await runSeed(prisma.client);

    const after = Date.now();
    const demo = prisma.created.user!.find((user) => user.username === 'demo')!;
    const demoSeed = data.users.find((user) => user.username === 'demo')!;
    const createdAt = (demo.createdAt as Date).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(
      before - demoSeed.minutesAgo * 60_000,
    );
    expect(createdAt).toBeLessThanOrEqual(after - demoSeed.minutesAgo * 60_000);
  });
});
