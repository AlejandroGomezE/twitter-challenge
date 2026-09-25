import {
  BODY_MAX_LENGTH,
  bodyLength,
} from '../../modules/posts/posts.rules.js';
import {
  BIO_MAX_LENGTH,
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
  isValidDisplayName,
  normalizeUsername,
} from '../../modules/users/username.rules.js';
import { SEED_COMMENTS } from './seed-comments.js';
import { DEMO_USERNAME, SEED_USERS } from './seed-users.js';

// The full seed data set, derived deterministically from the hand-written
// content in seed-users.ts / seed-comments.ts. Pure: no I/O, no Prisma, no
// randomness. Every timestamp is an offset in minutes before a `now` chosen
// by the writer (run-seed.ts), so the data always looks recent.
//
// Rows reference each other by natural keys (usernames, post/comment keys);
// the writer maps those to database ids.

export const SEED_PASSWORD = 'password1234';
export const SEED_EMAIL_DOMAIN = 'example.com';

const MINUTE = 1;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Posts are spread over the last ~14 days.
const POST_WINDOW = 14 * DAY;
// Follows happen over the last ~20 days; every account is older than that.
const FOLLOW_WINDOW = 20 * DAY;
const OLDEST_ACCOUNT_AGE = 60 * DAY;

// How many follow/like notifications `demo` gets (newest first; every
// comment on demo's posts gets one), and how many of each kind stay unread.
const DEMO_FOLLOW_NOTIFICATIONS = 4;
const DEMO_LIKE_NOTIFICATIONS = 6;
const DEMO_UNREAD_PER_TYPE = 2;

export type SeedNotificationType = 'follow' | 'like' | 'comment';

export interface SeedUser {
  username: string;
  email: string;
  displayName: string;
  bio: string;
  minutesAgo: number;
}

export interface SeedPost {
  // `<username>#<index>`, index 0 = that user's newest post.
  key: string;
  author: string;
  body: string;
  minutesAgo: number;
}

export interface SeedFollow {
  follower: string;
  following: string;
  minutesAgo: number;
}

export interface SeedLike {
  username: string;
  postKey: string;
  minutesAgo: number;
}

export interface SeedComment {
  key: string;
  author: string;
  postKey: string;
  body: string;
  minutesAgo: number;
}

export interface SeedNotification {
  type: SeedNotificationType;
  recipient: string;
  actor: string;
  // The liked / commented-on post; unset for 'follow'.
  postKey?: string;
  // Set only for 'comment'.
  commentKey?: string;
  minutesAgo: number;
  // Unset while unread.
  readMinutesAgo?: number;
}

export interface SeedData {
  users: SeedUser[];
  posts: SeedPost[];
  follows: SeedFollow[];
  likes: SeedLike[];
  comments: SeedComment[];
  notifications: SeedNotification[];
}

export function postKey(username: string, index: number): string {
  return `${username}#${index}`;
}

// Small deterministic integer hash in [0, 100): stands in for randomness so
// the follow graph and likes look irregular yet are identical on every run.
function score(salt: number, a: number, b: number): number {
  let h = Math.imul(salt + 1, 0x27d4eb2f);
  h ^= Math.imul(a + 1, 0x9e3779b1);
  h ^= Math.imul(b + 1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) % 100;
}

// A point strictly between an event `minutesAgo` and now, used for things
// that must happen after it (a like or comment after its post).
function laterThan(minutesAgo: number, a: number, b: number): number {
  const fraction = (1 + ((a + b) % 9)) / 10; // 0.1 .. 0.9
  return Math.floor(minutesAgo * fraction);
}

function buildUsers(): SeedUser[] {
  return SEED_USERS.map((profile, index) => ({
    username: profile.username,
    email: `${profile.username}@${SEED_EMAIL_DOMAIN}`,
    displayName: profile.displayName,
    bio: profile.bio,
    // demo is the oldest account; the rest joined a day apart after it.
    minutesAgo: OLDEST_ACCOUNT_AGE - index * DAY,
  }));
}

function buildPosts(): SeedPost[] {
  return SEED_USERS.flatMap((profile, userIndex) =>
    profile.posts.map((body, index) => {
      // Even spacing across the window per user, shifted per user/post by up
      // to 8 hours so feeds interleave; always at least 5 minutes old.
      const spacing = Math.floor(POST_WINDOW / profile.posts.length);
      const jitter = (userIndex * 137 + index * 53) % (8 * HOUR);
      return {
        key: postKey(profile.username, index),
        author: profile.username,
        body,
        minutesAgo: index * spacing + jitter + 5 * MINUTE,
      };
    }),
  );
}

// Not a complete graph: demo follows 20 of the other 29 users (so Following
// and For you differ), every odd-indexed user follows demo, and everyone
// else follows a ~third of the others.
function isFollowing(follower: number, following: number): boolean {
  if (follower === following) {
    return false;
  }
  if (follower === 0) {
    return following % 3 !== 0;
  }
  if (following === 0) {
    return follower % 2 === 1;
  }
  return score(1, follower, following) < 35;
}

function buildFollows(users: SeedUser[]): SeedFollow[] {
  const follows: SeedFollow[] = [];
  users.forEach((follower, i) => {
    users.forEach((following, j) => {
      if (isFollowing(i, j)) {
        follows.push({
          follower: follower.username,
          following: following.username,
          // Spread over the window, at a varied time of day.
          minutesAgo:
            Math.floor((score(3, i, j) * FOLLOW_WINDOW) / 100) +
            score(4, i, j) * 14 * MINUTE +
            30 * MINUTE,
        });
      }
    });
  });
  return follows;
}

// Every user likes a scattering of other users' posts; roughly one post in
// seven is "popular" and gets liked by most people. Never one's own post.
function buildLikes(users: SeedUser[], posts: SeedPost[]): SeedLike[] {
  const likes: SeedLike[] = [];
  users.forEach((user, u) => {
    posts.forEach((post, p) => {
      if (post.author === user.username) {
        return;
      }
      const threshold = p % 7 === 3 ? 60 : 12;
      if (score(2, u, p) < threshold) {
        likes.push({
          username: user.username,
          postKey: post.key,
          minutesAgo: laterThan(post.minutesAgo, u, p),
        });
      }
    });
  });
  return likes;
}

function buildComments(posts: SeedPost[]): SeedComment[] {
  const postsByKey = new Map(posts.map((post) => [post.key, post]));
  return SEED_COMMENTS.map((spec, index) => {
    const key = postKey(spec.on.username, spec.on.index);
    const post = postsByKey.get(key);
    if (!post) {
      throw new Error(`Seed comment #${index} points at unknown post ${key}`);
    }
    return {
      key: `comment#${index}`,
      author: spec.author,
      postKey: key,
      body: spec.body,
      minutesAgo: laterThan(post.minutesAgo, index, 4),
    };
  });
}

function newestFirst<T extends { minutesAgo: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.minutesAgo - b.minutesAgo);
}

// Notifications for demo, each mirroring a seeded row (what the
// notifications listener would have written): the newest follows of demo,
// the newest likes on demo's posts and every comment on them. The newest
// two of each kind are unread; the rest were read a little after they
// arrived.
function buildDemoNotifications(
  posts: SeedPost[],
  follows: SeedFollow[],
  likes: SeedLike[],
  comments: SeedComment[],
): SeedNotification[] {
  const demoPostKeys = new Set(
    posts
      .filter((post) => post.author === DEMO_USERNAME)
      .map((post) => post.key),
  );

  const withReadState = (
    rows: Omit<SeedNotification, 'recipient' | 'readMinutesAgo'>[],
  ): SeedNotification[] =>
    newestFirst(rows).map((row, index) => ({
      ...row,
      recipient: DEMO_USERNAME,
      readMinutesAgo:
        index < DEMO_UNREAD_PER_TYPE
          ? undefined
          : Math.max(0, row.minutesAgo - 20 * MINUTE),
    }));

  const fromFollows = withReadState(
    newestFirst(follows.filter((follow) => follow.following === DEMO_USERNAME))
      .slice(0, DEMO_FOLLOW_NOTIFICATIONS)
      .map((follow) => ({
        type: 'follow' as const,
        actor: follow.follower,
        minutesAgo: follow.minutesAgo,
      })),
  );

  const fromLikes = withReadState(
    newestFirst(likes.filter((like) => demoPostKeys.has(like.postKey)))
      .slice(0, DEMO_LIKE_NOTIFICATIONS)
      .map((like) => ({
        type: 'like' as const,
        actor: like.username,
        postKey: like.postKey,
        minutesAgo: like.minutesAgo,
      })),
  );

  const fromComments = withReadState(
    comments
      .filter((comment) => demoPostKeys.has(comment.postKey))
      .map((comment) => ({
        type: 'comment' as const,
        actor: comment.author,
        postKey: comment.postKey,
        commentKey: comment.key,
        minutesAgo: comment.minutesAgo,
      })),
  );

  return newestFirst([...fromFollows, ...fromLikes, ...fromComments]);
}

export function buildSeedData(): SeedData {
  const users = buildUsers();
  const posts = buildPosts();
  const follows = buildFollows(users);
  const likes = buildLikes(users, posts);
  const comments = buildComments(posts);
  const notifications = buildDemoNotifications(posts, follows, likes, comments);
  return { users, posts, follows, likes, comments, notifications };
}

function isValidBody(body: string): boolean {
  // Seed bodies are stored as written, so they must already be trimmed.
  const length = bodyLength(body);
  return body === body.trim() && length >= 1 && length <= BODY_MAX_LENGTH;
}

// Throws on the first seed row that breaks an app rule (the same rules the
// DTOs enforce), so bad seed content fails loudly instead of being written.
export function validateSeedData(data: SeedData): void {
  const usernames = new Set<string>();
  for (const user of data.users) {
    const { username } = user;
    if (
      username !== normalizeUsername(username) ||
      username.length < USERNAME_MIN_LENGTH ||
      username.length > USERNAME_MAX_LENGTH ||
      !USERNAME_PATTERN.test(username) ||
      RESERVED_USERNAMES.includes(username)
    ) {
      throw new Error(`Seed user "${username}" has an invalid username`);
    }
    if (usernames.has(username)) {
      throw new Error(`Seed user "${username}" is duplicated`);
    }
    usernames.add(username);
    if (!isValidDisplayName(user.displayName)) {
      throw new Error(`Seed user "${username}" has an invalid display name`);
    }
    if (user.bio !== user.bio.trim() || user.bio.length > BIO_MAX_LENGTH) {
      throw new Error(
        `Seed user "${username}" has a bio over ${BIO_MAX_LENGTH} characters`,
      );
    }
  }

  const postAuthors = new Map<string, string>();
  for (const post of data.posts) {
    if (!isValidBody(post.body)) {
      throw new Error(
        `Seed post ${post.key} must be 1-${BODY_MAX_LENGTH} characters (has ${bodyLength(post.body)})`,
      );
    }
    postAuthors.set(post.key, post.author);
  }

  for (const comment of data.comments) {
    if (!isValidBody(comment.body)) {
      throw new Error(
        `Seed ${comment.key} must be 1-${BODY_MAX_LENGTH} characters`,
      );
    }
    if (!usernames.has(comment.author)) {
      throw new Error(
        `Seed ${comment.key} has unknown author "${comment.author}"`,
      );
    }
    if (postAuthors.get(comment.postKey) === comment.author) {
      throw new Error(`Seed ${comment.key} is on its author's own post`);
    }
  }

  for (const follow of data.follows) {
    if (follow.follower === follow.following) {
      throw new Error(`Seed user "${follow.follower}" follows themselves`);
    }
  }

  for (const like of data.likes) {
    if (postAuthors.get(like.postKey) === like.username) {
      throw new Error(
        `Seed user "${like.username}" likes their own post ${like.postKey}`,
      );
    }
  }
}
