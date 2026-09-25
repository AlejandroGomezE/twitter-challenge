import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { ARGON2_OPTIONS } from '../../modules/users/users.service.js';
import { SEED_PASSWORD, buildSeedData, validateSeedData } from './seed-data.js';

export interface RunSeedOptions {
  // Leave the database untouched if it already has any user.
  ifEmpty?: boolean;
  // Reference point for every relative seed timestamp. Defaults to now.
  now?: Date;
}

// Rows written by one run (all zero when skipped).
export interface SeedSummary {
  skipped: boolean;
  users: number;
  posts: number;
  follows: number;
  likes: number;
  comments: number;
  notifications: number;
}

// Generous: ~1.5k rows on SQLite take well under a second, but the default
// 5s interactive-transaction timeout leaves little margin on a slow disk.
const TRANSACTION_TIMEOUT_MS = 60_000;

// Resets the seedable tables to the seed data set: in one transaction, wipes
// every notification, comment, like, follow, post, session and user, then
// inserts the seed rows. With `ifEmpty`, returns early (skipped) when any
// user exists, so an already-used database is never wiped.
export async function runSeed(
  prisma: PrismaClient,
  options: RunSeedOptions = {},
): Promise<SeedSummary> {
  const data = buildSeedData();
  validateSeedData(data);

  if (options.ifEmpty && (await prisma.user.count()) > 0) {
    return {
      skipped: true,
      users: 0,
      posts: 0,
      follows: 0,
      likes: 0,
      comments: 0,
      notifications: 0,
    };
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const at = (minutesAgo: number): Date =>
    new Date(nowMs - minutesAgo * 60_000);

  // Every seed user shares one password, hashed once, the same way sign-up
  // hashes it. Done before the transaction so it isn't held open meanwhile.
  const passwordHash = await argon2.hash(SEED_PASSWORD, ARGON2_OPTIONS);

  // Rows reference each other by natural keys in the seed data; ids are
  // assigned here so relations can be wired without reading rows back.
  const userIds = new Map(
    data.users.map((user) => [user.username, randomUUID()]),
  );
  const postIds = new Map(data.posts.map((post) => [post.key, randomUUID()]));
  const commentIds = new Map(
    data.comments.map((comment) => [comment.key, randomUUID()]),
  );
  const idOf = (ids: Map<string, string>, key: string): string => {
    const id = ids.get(key);
    if (!id) {
      throw new Error(`Seed data references unknown key "${key}"`);
    }
    return id;
  };

  return prisma.$transaction(
    async (tx) => {
      // Children before parents, so no foreign key is ever left dangling.
      await tx.notification.deleteMany();
      await tx.comment.deleteMany();
      await tx.like.deleteMany();
      await tx.follow.deleteMany();
      await tx.post.deleteMany();
      await tx.session.deleteMany();
      await tx.user.deleteMany();

      const users = await tx.user.createMany({
        data: data.users.map((user) => ({
          id: idOf(userIds, user.username),
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          bio: user.bio,
          passwordHash,
          createdAt: at(user.minutesAgo),
        })),
      });

      const posts = await tx.post.createMany({
        data: data.posts.map((post) => ({
          id: idOf(postIds, post.key),
          authorId: idOf(userIds, post.author),
          body: post.body,
          createdAt: at(post.minutesAgo),
        })),
      });

      const follows = await tx.follow.createMany({
        data: data.follows.map((follow) => ({
          followerId: idOf(userIds, follow.follower),
          followingId: idOf(userIds, follow.following),
          createdAt: at(follow.minutesAgo),
        })),
      });

      const likes = await tx.like.createMany({
        data: data.likes.map((like) => ({
          userId: idOf(userIds, like.username),
          postId: idOf(postIds, like.postKey),
          createdAt: at(like.minutesAgo),
        })),
      });

      const comments = await tx.comment.createMany({
        data: data.comments.map((comment) => ({
          id: idOf(commentIds, comment.key),
          postId: idOf(postIds, comment.postKey),
          authorId: idOf(userIds, comment.author),
          body: comment.body,
          createdAt: at(comment.minutesAgo),
        })),
      });

      const notifications = await tx.notification.createMany({
        data: data.notifications.map((notification) => ({
          recipientId: idOf(userIds, notification.recipient),
          actorId: idOf(userIds, notification.actor),
          type: notification.type,
          postId: notification.postKey
            ? idOf(postIds, notification.postKey)
            : null,
          commentId: notification.commentKey
            ? idOf(commentIds, notification.commentKey)
            : null,
          readAt:
            notification.readMinutesAgo === undefined
              ? null
              : at(notification.readMinutesAgo),
          createdAt: at(notification.minutesAgo),
        })),
      });

      return {
        skipped: false,
        users: users.count,
        posts: posts.count,
        follows: follows.count,
        likes: likes.count,
        comments: comments.count,
        notifications: notifications.count,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
}
