import {
  BODY_MAX_LENGTH,
  bodyLength,
  normalizeBody,
} from '../../../modules/posts/posts.rules.js';
import {
  SEED_EMAIL_DOMAIN,
  SEED_PASSWORD,
  buildSeedData,
  postKey,
  validateSeedData,
  type SeedData,
} from '../seed-data.js';
import { DEMO_USERNAME, SEED_USERS } from '../seed-users.js';

const MINUTES_PER_DAY = 24 * 60;

// The real post/comment body rule (IsPostBody): after trimming, 1–280 code
// points. Seed bodies are stored verbatim, so they must also be pre-trimmed.
function passesPostRule(body: string): boolean {
  const normalized = normalizeBody(body);
  const length = bodyLength(normalized);
  return normalized === body && length >= 1 && length <= BODY_MAX_LENGTH;
}

function pairKey(a: string, b: string): string {
  return `${a}->${b}`;
}

describe('seed data', () => {
  const data = buildSeedData();
  const usernames = data.users.map((user) => user.username);
  const others = usernames.filter((username) => username !== DEMO_USERNAME);
  const postsByKey = new Map(data.posts.map((post) => [post.key, post]));
  const usersByName = new Map(data.users.map((user) => [user.username, user]));

  describe('users', () => {
    it('has exactly 30 users with unique usernames, demo included', () => {
      expect(data.users).toHaveLength(30);
      expect(new Set(usernames).size).toBe(30);
      expect(usernames).toContain(DEMO_USERNAME);
    });

    it('gives every user a unique <username>@example.com email', () => {
      expect(SEED_EMAIL_DOMAIN).toBe('example.com');
      for (const user of data.users) {
        expect(user.email).toBe(`${user.username}@example.com`);
      }
      expect(new Set(data.users.map((user) => user.email)).size).toBe(30);
      expect(usersByName.get(DEMO_USERNAME)?.email).toBe('demo@example.com');
    });

    it('uses the documented password, which meets the 12-128 length rule', () => {
      expect(SEED_PASSWORD).toBe('password1234');
      expect(SEED_PASSWORD.length).toBeGreaterThanOrEqual(12);
      expect(SEED_PASSWORD.length).toBeLessThanOrEqual(128);
    });

    it('mirrors the hand-written profiles in order', () => {
      expect(usernames).toEqual(SEED_USERS.map((profile) => profile.username));
      for (const [index, profile] of SEED_USERS.entries()) {
        expect(data.users[index]).toMatchObject({
          displayName: profile.displayName,
          bio: profile.bio,
        });
      }
    });
  });

  describe('posts', () => {
    it('gives every user 5-8 posts', () => {
      for (const username of usernames) {
        const count = data.posts.filter(
          (post) => post.author === username,
        ).length;
        expect(count, username).toBeGreaterThanOrEqual(5);
        expect(count, username).toBeLessThanOrEqual(8);
      }
    });

    it('has unique `<username>#<index>` keys', () => {
      expect(postsByKey.size).toBe(data.posts.length);
      const byAuthor = new Map<string, number>();
      for (const post of data.posts) {
        const index = byAuthor.get(post.author) ?? 0;
        expect(post.key).toBe(postKey(post.author, index));
        byAuthor.set(post.author, index + 1);
      }
    });

    it('every post and comment body passes the real post body rule', () => {
      for (const post of data.posts) {
        expect(passesPostRule(post.body), post.key).toBe(true);
      }
      for (const comment of data.comments) {
        expect(passesPostRule(comment.body), comment.key).toBe(true);
      }
    });

    it('spreads posts over the last ~14 days, newest first per author', () => {
      for (const post of data.posts) {
        expect(post.minutesAgo).toBeGreaterThan(0);
        expect(post.minutesAgo).toBeLessThanOrEqual(14 * MINUTES_PER_DAY);
      }
      // A timeline, not one timestamp: posts land on many distinct days.
      const days = new Set(
        data.posts.map((post) => Math.floor(post.minutesAgo / MINUTES_PER_DAY)),
      );
      expect(days.size).toBeGreaterThanOrEqual(10);

      for (const username of usernames) {
        const ages = data.posts
          .filter((post) => post.author === username)
          .map((post) => post.minutesAgo);
        expect(ages).toEqual([...ages].sort((a, b) => a - b));
      }
    });

    it('every post is newer than its author account', () => {
      for (const post of data.posts) {
        const author = usersByName.get(post.author);
        expect(author, post.key).toBeDefined();
        expect(post.minutesAgo).toBeLessThan(author!.minutesAgo);
      }
    });
  });

  describe('follows', () => {
    it('references known users, with no self-follow and no duplicate', () => {
      const seen = new Set<string>();
      for (const follow of data.follows) {
        expect(usersByName.has(follow.follower)).toBe(true);
        expect(usersByName.has(follow.following)).toBe(true);
        expect(follow.follower).not.toBe(follow.following);
        const key = pairKey(follow.follower, follow.following);
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    });

    it('demo follows most but not all other users, and has followers', () => {
      const demoFollows = data.follows.filter(
        (follow) => follow.follower === DEMO_USERNAME,
      );
      expect(demoFollows.length).toBeGreaterThan(others.length / 2);
      expect(demoFollows.length).toBeLessThan(others.length);

      const followers = data.follows.filter(
        (follow) => follow.following === DEMO_USERNAME,
      );
      expect(followers.length).toBeGreaterThan(0);
    });

    it('is not a complete graph, and every user follows or is followed', () => {
      expect(data.follows.length).toBeLessThan(30 * 29);
      for (const username of usernames) {
        const involved = data.follows.some(
          (follow) =>
            follow.follower === username || follow.following === username,
        );
        expect(involved, username).toBe(true);
      }
    });

    it('every follow happens after both accounts exist and not in the future', () => {
      for (const follow of data.follows) {
        expect(follow.minutesAgo).toBeGreaterThan(0);
        expect(follow.minutesAgo).toBeLessThan(
          usersByName.get(follow.follower)!.minutesAgo,
        );
        expect(follow.minutesAgo).toBeLessThan(
          usersByName.get(follow.following)!.minutesAgo,
        );
      }
    });
  });

  describe('likes', () => {
    it('references known users and posts, never a self-like or a duplicate', () => {
      const seen = new Set<string>();
      for (const like of data.likes) {
        const post = postsByKey.get(like.postKey);
        expect(post, like.postKey).toBeDefined();
        expect(usersByName.has(like.username)).toBe(true);
        expect(post!.author).not.toBe(like.username);
        const key = pairKey(like.username, like.postKey);
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    });

    it('every user likes several posts by others (cross-likes)', () => {
      for (const username of usernames) {
        const count = data.likes.filter(
          (like) => like.username === username,
        ).length;
        expect(count, username).toBeGreaterThanOrEqual(3);
      }
    });

    it('every like is after its post and not in the future', () => {
      for (const like of data.likes) {
        const post = postsByKey.get(like.postKey)!;
        expect(like.minutesAgo).toBeGreaterThanOrEqual(0);
        expect(like.minutesAgo).toBeLessThan(post.minutesAgo);
      }
    });
  });

  describe('comments', () => {
    it('has a handful of uniquely keyed comments on real posts by known users', () => {
      expect(data.comments.length).toBeGreaterThan(0);
      expect(new Set(data.comments.map((comment) => comment.key)).size).toBe(
        data.comments.length,
      );
      for (const comment of data.comments) {
        expect(postsByKey.has(comment.postKey), comment.key).toBe(true);
        expect(usersByName.has(comment.author), comment.key).toBe(true);
      }
    });

    it('never comments on the author own post', () => {
      for (const comment of data.comments) {
        expect(postsByKey.get(comment.postKey)!.author, comment.key).not.toBe(
          comment.author,
        );
      }
    });

    it('every comment is after its post and not in the future', () => {
      for (const comment of data.comments) {
        const post = postsByKey.get(comment.postKey)!;
        expect(comment.minutesAgo).toBeGreaterThanOrEqual(0);
        expect(comment.minutesAgo).toBeLessThan(post.minutesAgo);
      }
    });
  });

  describe('notifications', () => {
    const followKeys = new Set(
      data.follows.map((follow) => pairKey(follow.follower, follow.following)),
    );
    const likeKeys = new Set(
      data.likes.map((like) => pairKey(like.username, like.postKey)),
    );
    const commentsByKey = new Map(
      data.comments.map((comment) => [comment.key, comment]),
    );

    it('are all for demo, never from demo, and cover follow, like and comment', () => {
      expect(data.notifications.length).toBeGreaterThan(0);
      for (const notification of data.notifications) {
        expect(notification.recipient).toBe(DEMO_USERNAME);
        expect(notification.actor).not.toBe(DEMO_USERNAME);
      }
      expect(new Set(data.notifications.map((n) => n.type))).toEqual(
        new Set(['follow', 'like', 'comment']),
      );
    });

    it('each one mirrors a seeded follow, like or comment row', () => {
      for (const notification of data.notifications) {
        switch (notification.type) {
          case 'follow':
            expect(notification.postKey).toBeUndefined();
            expect(notification.commentKey).toBeUndefined();
            expect(
              followKeys.has(pairKey(notification.actor, DEMO_USERNAME)),
            ).toBe(true);
            break;
          case 'like':
            expect(notification.commentKey).toBeUndefined();
            expect(postsByKey.get(notification.postKey!)?.author).toBe(
              DEMO_USERNAME,
            );
            expect(
              likeKeys.has(pairKey(notification.actor, notification.postKey!)),
            ).toBe(true);
            break;
          case 'comment': {
            const comment = commentsByKey.get(notification.commentKey!);
            expect(comment).toBeDefined();
            expect(comment!.author).toBe(notification.actor);
            expect(comment!.postKey).toBe(notification.postKey);
            expect(postsByKey.get(comment!.postKey)?.author).toBe(
              DEMO_USERNAME,
            );
            expect(notification.minutesAgo).toBe(comment!.minutesAgo);
            break;
          }
        }
      }
    });

    it('includes a notification for every comment on a demo post', () => {
      const demoComments = data.comments.filter(
        (comment) => postsByKey.get(comment.postKey)!.author === DEMO_USERNAME,
      );
      expect(demoComments.length).toBeGreaterThan(0);
      const notified = new Set(
        data.notifications
          .filter((n) => n.type === 'comment')
          .map((n) => n.commentKey),
      );
      for (const comment of demoComments) {
        expect(notified.has(comment.key), comment.key).toBe(true);
      }
    });

    it('some are unread; read ones were read after they arrived', () => {
      const unread = data.notifications.filter(
        (n) => n.readMinutesAgo === undefined,
      );
      expect(unread.length).toBeGreaterThan(0);
      expect(unread.length).toBeLessThan(data.notifications.length);
      for (const notification of data.notifications) {
        if (notification.readMinutesAgo !== undefined) {
          expect(notification.readMinutesAgo).toBeGreaterThanOrEqual(0);
          expect(notification.readMinutesAgo).toBeLessThanOrEqual(
            notification.minutesAgo,
          );
        }
      }
    });

    it('are ordered newest first', () => {
      const ages = data.notifications.map((n) => n.minutesAgo);
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
    });
  });

  it('is deterministic: two builds are deep-equal', () => {
    expect(buildSeedData()).toEqual(buildSeedData());
    expect(buildSeedData()).toEqual(data);
  });
});

describe('validateSeedData', () => {
  // A fresh deep copy per test, so tampering never leaks between tests.
  function freshData(): SeedData {
    return structuredClone(buildSeedData());
  }

  it('accepts the built data set', () => {
    expect(() => validateSeedData(buildSeedData())).not.toThrow();
  });

  it('rejects a post body over 280 characters', () => {
    const data = freshData();
    data.posts[3].body = 'x'.repeat(BODY_MAX_LENGTH + 1);
    expect(() => validateSeedData(data)).toThrow(
      `Seed post ${data.posts[3].key} must be 1-280 characters (has 281)`,
    );
  });

  it('accepts a 280-code-point body made of astral emoji', () => {
    const data = freshData();
    data.posts[0].body = '😀'.repeat(BODY_MAX_LENGTH);
    expect(() => validateSeedData(data)).not.toThrow();
  });

  it('rejects an empty or untrimmed post body', () => {
    const empty = freshData();
    empty.posts[0].body = '';
    expect(() => validateSeedData(empty)).toThrow(/must be 1-280 characters/);

    const untrimmed = freshData();
    untrimmed.posts[0].body = ` ${untrimmed.posts[0].body}`;
    expect(() => validateSeedData(untrimmed)).toThrow(
      /must be 1-280 characters/,
    );
  });

  it('rejects a comment body over 280 characters', () => {
    const data = freshData();
    data.comments[0].body = 'y'.repeat(BODY_MAX_LENGTH + 1);
    expect(() => validateSeedData(data)).toThrow(
      `Seed ${data.comments[0].key} must be 1-280 characters`,
    );
  });

  it('rejects a duplicate username', () => {
    const data = freshData();
    data.users[2].username = data.users[1].username;
    expect(() => validateSeedData(data)).toThrow(
      `Seed user "${data.users[1].username}" is duplicated`,
    );
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(21)],
    ['uppercase (not normalized)', 'Demo_User'],
    ['invalid characters', 'bad-name'],
    ['reserved', 'settings'],
  ])('rejects an invalid username (%s)', (_label, username) => {
    const data = freshData();
    data.users[1].username = username;
    expect(() => validateSeedData(data)).toThrow(
      `Seed user "${username}" has an invalid username`,
    );
  });

  it('rejects an invalid display name', () => {
    const data = freshData();
    data.users[1].displayName = '';
    expect(() => validateSeedData(data)).toThrow(/has an invalid display name/);
  });

  it('rejects an untrimmed or over-long bio', () => {
    const untrimmed = freshData();
    untrimmed.users[1].bio = `${untrimmed.users[1].bio} `;
    expect(() => validateSeedData(untrimmed)).toThrow(/has a bio over 160/);

    const long = freshData();
    long.users[1].bio = 'b'.repeat(161);
    expect(() => validateSeedData(long)).toThrow(/has a bio over 160/);
  });

  it('rejects a self-follow', () => {
    const data = freshData();
    data.follows.push({
      follower: 'demo',
      following: 'demo',
      minutesAgo: 10,
    });
    expect(() => validateSeedData(data)).toThrow(
      'Seed user "demo" follows themselves',
    );
  });

  it('rejects a self-like', () => {
    const data = freshData();
    data.likes.push({ username: 'demo', postKey: 'demo#0', minutesAgo: 1 });
    expect(() => validateSeedData(data)).toThrow(
      'Seed user "demo" likes their own post demo#0',
    );
  });

  it('rejects a comment on its author own post', () => {
    const data = freshData();
    const comment = data.comments[0];
    comment.author = postsAuthor(data, comment.postKey);
    expect(() => validateSeedData(data)).toThrow(
      `Seed ${comment.key} is on its author's own post`,
    );
  });

  it('rejects a comment by an unknown author', () => {
    const data = freshData();
    data.comments[0].author = 'nobody_here';
    expect(() => validateSeedData(data)).toThrow(
      `Seed ${data.comments[0].key} has unknown author "nobody_here"`,
    );
  });

  function postsAuthor(data: SeedData, key: string): string {
    const post = data.posts.find((candidate) => candidate.key === key);
    if (!post) {
      throw new Error(`no post ${key}`);
    }
    return post.author;
  }
});
