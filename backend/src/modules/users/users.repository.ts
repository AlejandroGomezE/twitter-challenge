import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { User } from '../../generated/prisma/client.js';

export interface CreateUserData {
  email: string;
  username: string;
  passwordHash: string;
}

// Only the keys present are written; `bio: null` clears the bio.
export interface UpdateProfileData {
  username?: string;
  bio?: string | null;
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
      data: { username: data.username, bio: data.bio },
    });
  }
}
