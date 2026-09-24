import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { normalizeBio, normalizeUsername } from './username.rules.js';
import { type UpdateProfileData, UsersRepository } from './users.repository.js';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
}

// Another user's profile as any signed-in user may see it — never the email.
export interface PublicProfile {
  username: string;
  bio: string | null;
  createdAt: Date;
}

// The caller's own profile.
export interface MyProfile {
  id: string;
  email: string;
  username: string;
  bio: string | null;
  createdAt: Date;
}

// Only the keys present are changed; an empty bio (or null) clears it.
export interface UpdateProfileInput {
  username?: string;
  bio?: string | null;
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
  constructor(private readonly usersRepository: UsersRepository) {}

  normalizeEmail(email: string): string {
    return normalizeEmail(email);
  }

  async create(
    email: string,
    username: string,
    password: string,
  ): Promise<PublicUser> {
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    try {
      const user = await this.usersRepository.create({
        email: normalizedEmail,
        username: normalizeUsername(username),
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

  async getProfile(username: string): Promise<PublicProfile> {
    const user = await this.usersRepository.findByUsername(
      normalizeUsername(username),
    );
    if (!user) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }
    return {
      username: user.username,
      bio: user.bio,
      createdAt: user.createdAt,
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
    try {
      const user = await this.usersRepository.updateProfile(userId, data);
      return this.toMyProfile(user);
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
  }

  toPublicUser(user: User): PublicUser {
    return { id: user.id, email: user.email, username: user.username };
  }

  private toMyProfile(user: User): MyProfile {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      bio: user.bio,
      createdAt: user.createdAt,
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
