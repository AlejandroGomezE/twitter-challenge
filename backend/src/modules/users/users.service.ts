import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, type User } from '../../generated/prisma/client.js';
import {
  type FollowCounts,
  FollowsService,
  type FollowUserPage,
} from '../follows/follows.service.js';
import { resolvePageSize } from '../posts/pagination.js';
import {
  type PageQuery,
  type PostPage,
  PostsService,
} from '../posts/posts.service.js';
import {
  decodeUsernameCursor,
  encodeUsernameCursor,
} from './username-cursor.js';
import {
  normalizeBio,
  normalizeDisplayName,
  normalizeUsername,
} from './username.rules.js';
import { type UpdateProfileData, UsersRepository } from './users.repository.js';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  // null for accounts created before display names existed.
  displayName: string | null;
}

// Another user's profile as any signed-in user may see it — never the email.
// The two booleans are relative to the viewer and false on their own profile.
export interface PublicProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  createdAt: Date;
  postCount: number;
  followerCount: number;
  followingCount: number;
  // The viewer follows this user.
  isFollowing: boolean;
  // This user follows the viewer.
  followsYou: boolean;
}

// The caller's own profile.
export interface MyProfile {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  createdAt: Date;
  postCount: number;
  followerCount: number;
  followingCount: number;
}

// Only the keys present are changed; an empty bio (or null) clears it. The
// display name can only be set or changed (the DTO rejects a blank one).
export interface UpdateProfileInput {
  username?: string;
  bio?: string | null;
  displayName?: string;
}

// OWASP-recommended argon2id parameters. argon2 generates a random salt per
// hash and encodes it (with these params) in the output string.
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';
const EMAIL_TAKEN_MESSAGE = 'Email is already registered';
const USERNAME_TAKEN_MESSAGE = 'Username is already taken';
const USER_NOT_FOUND_MESSAGE = 'User not found';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

// Column(s) behind a P2002. With the better-sqlite3 driver adapter (Prisma 7)
// there is no `meta.target`; the fields are reported under
// `meta.driverAdapterError.cause.constraint.fields`. `meta.target` is still
// read for non-adapter engines. Empty when neither is present.
function uniqueViolationFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = error.meta;
  const target = stringsOf(meta?.target);
  if (target.length > 0) {
    return target;
  }
  const adapterError = meta?.driverAdapterError;
  const cause = isRecord(adapterError) ? adapterError.cause : undefined;
  const constraint = isRecord(cause) ? cause.constraint : undefined;
  return isRecord(constraint) ? stringsOf(constraint.fields) : [];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly postsService: PostsService,
    private readonly followsService: FollowsService,
  ) {}

  normalizeEmail(email: string): string {
    return normalizeEmail(email);
  }

  async create(
    email: string,
    username: string,
    displayName: string,
    password: string,
  ): Promise<PublicUser> {
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    try {
      const user = await this.usersRepository.create({
        email: normalizedEmail,
        username: normalizeUsername(username),
        displayName: normalizeDisplayName(displayName),
        passwordHash,
      });
      return this.toPublicUser(user);
    } catch (error) {
      // Rely on the unique indexes instead of find-then-create, which would race.
      if (isPrismaError(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw new ConflictException(
          await this.signUpConflictMessage(error, normalizedEmail),
        );
      }
      throw error;
    }
  }

  // Returns the full record (including passwordHash) — only for credential
  // verification by the auth module. Never return it to a client.
  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(normalizeEmail(email));
  }

  async findById(id: string): Promise<PublicUser | null> {
    const user = await this.usersRepository.findById(id);
    return user ? this.toPublicUser(user) : null;
  }

  // `username`'s profile as `viewerId` sees it. A constant number of queries
  // (lookup, then post count, follow counts and relation concurrently); the
  // relation costs no query on your own profile.
  async getProfile(username: string, viewerId: string): Promise<PublicProfile> {
    const user = await this.findByUsernameOrThrow(username);
    const [postCount, counts, relation] = await Promise.all([
      this.postsService.countByAuthor(user.id),
      this.followsService.counts(user.id),
      this.followsService.relation(viewerId, user.id),
    ]);
    return {
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      createdAt: user.createdAt,
      postCount,
      followerCount: counts.followerCount,
      followingCount: counts.followingCount,
      isFollowing: relation.isFollowing,
      followsYou: relation.followsYou,
    };
  }

  // A user's posts, newest first, as `viewerId` sees them (likedByMe). 404
  // `User not found` for an unknown username.
  async listPosts(
    username: string,
    viewerId: string,
    query: PageQuery,
  ): Promise<PostPage> {
    const user = await this.findByUsernameOrThrow(username);
    return this.postsService.listByAuthor(user.id, viewerId, query);
  }

  // Users whose username or display name contains `query` (already
  // normalized and validated by SearchUsersQueryDto), ordered by username,
  // as `viewerId` sees them; the viewer is included if they match, with both
  // booleans false. A constant number of queries: the page (limit + 1 to
  // detect a next page) plus the two relation queries. The cursor is
  // validated before any query runs (400 `Invalid cursor`).
  async searchUsers(
    viewerId: string,
    query: string,
    page: PageQuery,
  ): Promise<FollowUserPage> {
    const afterUsername =
      page.cursor === undefined ? undefined : decodeUsernameCursor(page.cursor);
    const limit = resolvePageSize(page.limit);
    const rows = await this.usersRepository.searchPage({
      query,
      afterUsername,
      limit,
    });
    const users = rows.slice(0, limit);
    const last = users.at(-1);
    const nextCursor =
      rows.length > limit && last ? encodeUsernameCursor(last.username) : null;
    const { followedByViewer, followingViewer } =
      await this.followsService.relationsFor(
        viewerId,
        users.map((user) => user.id),
      );
    return {
      items: users.map((user) => ({
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        isFollowing: followedByViewer.has(user.id),
        followsYou: followingViewer.has(user.id),
      })),
      nextCursor,
    };
  }

  // Always scoped to the caller's own id. Re-setting your current username
  // is a no-op update (no unique violation against your own row).
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<MyProfile> {
    const data: UpdateProfileData = {};
    if (input.username !== undefined) {
      data.username = normalizeUsername(input.username);
    }
    if (input.bio !== undefined) {
      data.bio = input.bio === null ? null : normalizeBio(input.bio);
    }
    if (input.displayName !== undefined) {
      data.displayName = normalizeDisplayName(input.displayName);
    }
    let user: User;
    try {
      user = await this.usersRepository.updateProfile(userId, data);
    } catch (error) {
      // username is the only unique column this update can write.
      if (isPrismaError(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw new ConflictException(USERNAME_TAKEN_MESSAGE);
      }
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
      }
      throw error;
    }
    // Follows key on the user id, so a username change keeps them.
    const [postCount, counts] = await Promise.all([
      this.postsService.countByAuthor(user.id),
      this.followsService.counts(user.id),
    ]);
    return this.toMyProfile(user, postCount, counts);
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
    };
  }

  // Lookup is case-insensitive (usernames are stored normalized).
  private async findByUsernameOrThrow(username: string): Promise<User> {
    const user = await this.usersRepository.findByUsername(
      normalizeUsername(username),
    );
    if (!user) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    return user;
  }

  private toMyProfile(
    user: User,
    postCount: number,
    counts: FollowCounts,
  ): MyProfile {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      createdAt: user.createdAt,
      postCount,
      followerCount: counts.followerCount,
      followingCount: counts.followingCount,
    };
  }

  // Which unique field a sign-up collided on. Uses the fields Prisma reports;
  // if they are missing, falls back to checking whether the email exists.
  private async signUpConflictMessage(
    error: Prisma.PrismaClientKnownRequestError,
    normalizedEmail: string,
  ): Promise<string> {
    const fields = uniqueViolationFields(error);
    if (fields.includes('email')) {
      return EMAIL_TAKEN_MESSAGE;
    }
    if (fields.includes('username')) {
      return USERNAME_TAKEN_MESSAGE;
    }
    const existing = await this.usersRepository.findByEmail(normalizedEmail);
    return existing ? EMAIL_TAKEN_MESSAGE : USERNAME_TAKEN_MESSAGE;
  }
}
