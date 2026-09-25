import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type User } from '../../generated/prisma/client.js';

export interface CreateUserData {
  email: string;
  username: string;
  displayName: string;
  passwordHash: string;
}

// Only the keys present are written; `bio: null` clears the bio.
export interface UpdateProfileData {
  username?: string;
  bio?: string | null;
  displayName?: string;
}

// Columns a search result needs. Deliberately no email; the id is only used
// internally (the follow relation lookup).
export interface UserSearchRow {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
}

export interface SearchUsersParams {
  // Normalized search text (trimmed, `@` stripped), matched literally.
  query: string;
  // Username of the last row of the previous page; omitted for the first.
  afterUsername?: string;
  limit: number;
}

// Escape character for LIKE patterns (the `ESCAPE '!'` in searchPage must
// match). `!` rather than a backslash, so the SQL text needs no JS escaping.
const LIKE_ESCAPE = '!';

// `value` as a LIKE pattern matching it anywhere, with the LIKE wildcards
// (`%`, `_`) and the escape character itself escaped so they match literally.
export function containsPattern(value: string): string {
  return `%${value.replace(/[!%_]/g, (char) => `${LIKE_ESCAPE}${char}`)}%`;
}

// Data access for users. Returns full Prisma records (including
// passwordHash); UsersService decides what is exposed to callers.
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        displayName: data.displayName,
        passwordHash: data.passwordHash,
      },
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  updateProfile(id: string, data: UpdateProfileData): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        username: data.username,
        bio: data.bio,
        displayName: data.displayName,
      },
    });
  }

  // Users whose username or display name contains `query` (case-insensitive
  // for ASCII only: SQLite LIKE), ordered by username ascending, strictly
  // after `afterUsername`. Returns up to `limit + 1` rows: the extra row only
  // tells the caller that a next page exists.
  //
  // Raw SQL because Prisma's `contains` compiles to a LIKE without an ESCAPE
  // clause and doesn't escape `%`/`_` (a search for `_` would match every
  // user). Both comparisons on username use the column's BINARY collation,
  // so the keyset condition agrees with the ORDER BY.
  searchPage(params: SearchUsersParams): Promise<UserSearchRow[]> {
    const pattern = containsPattern(params.query);
    const after =
      params.afterUsername === undefined
        ? Prisma.empty
        : Prisma.sql`AND "username" > ${params.afterUsername}`;
    return this.prisma.$queryRaw<UserSearchRow[]>(Prisma.sql`
      SELECT "id", "username", "displayName", "bio"
      FROM "User"
      WHERE ("username" LIKE ${pattern} ESCAPE '!'
        OR "displayName" LIKE ${pattern} ESCAPE '!')
      ${after}
      ORDER BY "username" ASC
      LIMIT ${params.limit + 1}
    `);
  }
}
