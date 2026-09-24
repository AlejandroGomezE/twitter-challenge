import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';

export interface PublicUser {
  id: string;
  email: string;
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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  normalizeEmail(email: string): string {
    return normalizeEmail(email);
  }

  async create(email: string, password: string): Promise<PublicUser> {
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    try {
      const user = await this.usersRepository.create({
        email: normalizeEmail(email),
        passwordHash,
      });
      return this.toPublicUser(user);
    } catch (error) {
      // Rely on the unique index instead of find-then-create, which would race.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Email is already registered');
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

  toPublicUser(user: User): PublicUser {
    return { id: user.id, email: user.email };
  }
}
