import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  decodeCursor,
  encodeCursor,
  resolvePageSize,
} from '../posts/pagination.js';
import type { PageQuery } from '../posts/posts.service.js';
import { normalizeUsername } from '../users/username.rules.js';
import {
  type FindFollowPageParams,
  type FollowEdge,
  FollowsRepository,
  type FollowUserRow,
} from './follows.repository.js';

// A user in a followers/following list or in the suggestions, as the viewer
// sees them. Both booleans are relative to the viewer and false on the
// viewer's own row.
export interface FollowUserView {
  username: string;
  bio: string | null;
  // The viewer follows this user.
  isFollowing: boolean;
  // This user follows the viewer.
  followsYou: boolean;
}

// One page of a followers/following list, most recent follow first.
// `nextCursor` is null on the last page.
export interface FollowUserPage {
  items: FollowUserView[];
  nextCursor: string | null;
}

export interface FollowUserList {
  items: FollowUserView[];
}

// The caller's follow state on a user after a follow/unfollow, with the
// target's new follower total.
export interface FollowState {
  following: boolean;
  followerCount: number;
}

export interface FollowCounts {
  followerCount: number;
  followingCount: number;
}

// How `viewerId` and a target relate; both false when they're the same user.
export interface FollowRelation {
  isFollowing: boolean;
  followsYou: boolean;
}

export const SUGGESTIONS_DEFAULT_LIMIT = 3;
export const SUGGESTIONS_MAX_LIMIT = 10;

// Same message as the profile 404 (UsersService).
const USER_NOT_FOUND_MESSAGE = 'User not found';
const FOLLOW_SELF_MESSAGE = 'You cannot follow yourself';
const UNFOLLOW_SELF_MESSAGE = 'You cannot unfollow yourself';
// Prisma's code for a foreign-key violation.
const FOREIGN_KEY_VIOLATION = 'P2003';

type PageReader = (params: FindFollowPageParams) => Promise<FollowEdge[]>;

// Follows between users. Exported (via FollowsModule) for the users module
// (profile counts and relation) and the posts module (the Following feed);
// it must never import either of them, so usernames are resolved through
// FollowsRepository.
@Injectable()
export class FollowsService {
  constructor(private readonly followsRepository: FollowsRepository) {}

  // Follows (`following: true`) or unfollows `username` as `followerId` (the
  // session user); both idempotent. 404 for an unknown user — checked first,
  // and again via the FK violation (P2003) if the user is deleted between the
  // check and the insert, so that race is a 404, not a 500. 400 on yourself.
  async setFollowing(
    followerId: string,
    username: string,
    following: boolean,
  ): Promise<FollowState> {
    const targetId = await this.resolveUserId(username);
    if (targetId === followerId) {
      throw new BadRequestException(
        following ? FOLLOW_SELF_MESSAGE : UNFOLLOW_SELF_MESSAGE,
      );
    }
    try {
      if (following) {
        await this.followsRepository.follow(followerId, targetId);
      } else {
        await this.followsRepository.unfollow(followerId, targetId);
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
      }
      throw error;
    }
    const followerCount = await this.followsRepository.followerCount(targetId);
    return { following, followerCount };
  }

  // Users following `username`, most recent follow first, as `viewerId`
  // sees them. 404 for an unknown user; 400 `Invalid cursor`.
  listFollowers(
    username: string,
    viewerId: string,
    query: PageQuery,
  ): Promise<FollowUserPage> {
    return this.page(username, viewerId, query, (params) =>
      this.followsRepository.findFollowersPage(params),
    );
  }

  // Users `username` follows, most recent follow first; same rules as
  // listFollowers.
  listFollowing(
    username: string,
    viewerId: string,
    query: PageQuery,
  ): Promise<FollowUserPage> {
    return this.page(username, viewerId, query, (params) =>
      this.followsRepository.findFollowingPage(params),
    );
  }

  // "Who to follow": users `viewerId` doesn't follow (never `viewerId`),
  // newest accounts first. `isFollowing` is false by construction.
  async suggestions(
    viewerId: string,
    limit: number = SUGGESTIONS_DEFAULT_LIMIT,
  ): Promise<FollowUserList> {
    const users = await this.followsRepository.findSuggestions(viewerId, limit);
    return { items: await this.toViews(users, viewerId) };
  }

  // Ids of every user `userId` follows (for the Following feed).
  followedIds(userId: string): Promise<string[]> {
    return this.followsRepository.followedIds(userId);
  }

  async counts(userId: string): Promise<FollowCounts> {
    const [followerCount, followingCount] = await Promise.all([
      this.followsRepository.followerCount(userId),
      this.followsRepository.followingCount(userId),
    ]);
    return { followerCount, followingCount };
  }

  // How `viewerId` relates to `targetId` (two queries at most).
  async relation(viewerId: string, targetId: string): Promise<FollowRelation> {
    if (viewerId === targetId) {
      return { isFollowing: false, followsYou: false };
    }
    const { followedByViewer, followingViewer } =
      await this.followsRepository.relationsAmong(viewerId, [targetId]);
    return {
      isFollowing: followedByViewer.has(targetId),
      followsYou: followingViewer.has(targetId),
    };
  }

  // Keyset page over (follow createdAt, other user's id): one query for the
  // rows (limit + 1 to detect a next page) plus the two relation queries —
  // never one per row. The cursor is validated before any query runs.
  private async page(
    username: string,
    viewerId: string,
    query: PageQuery,
    read: PageReader,
  ): Promise<FollowUserPage> {
    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const limit = resolvePageSize(query.limit);
    const userId = await this.resolveUserId(username);
    const rows = await read({ userId, cursor, limit });
    const edges = rows.slice(0, limit);
    const last = edges.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.user.id })
        : null;
    return {
      items: await this.toViews(
        edges.map((edge) => edge.user),
        viewerId,
      ),
      nextCursor,
    };
  }

  private async toViews(
    users: FollowUserRow[],
    viewerId: string,
  ): Promise<FollowUserView[]> {
    const { followedByViewer, followingViewer } =
      await this.followsRepository.relationsAmong(
        viewerId,
        users.filter((user) => user.id !== viewerId).map((user) => user.id),
      );
    return users.map((user) => ({
      username: user.username,
      bio: user.bio,
      isFollowing: followedByViewer.has(user.id),
      followsYou: followingViewer.has(user.id),
    }));
  }

  // Lookup is case-insensitive (usernames are stored normalized), exactly as
  // UsersService.getProfile.
  private async resolveUserId(username: string): Promise<string> {
    const user = await this.followsRepository.findUserIdByUsername(
      normalizeUsername(username),
    );
    if (!user) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    return user.id;
  }
}
