import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, Session } from '../generated/prisma/client.js';

export interface CreateSessionData {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export type SessionWithUser = Prisma.SessionGetPayload<{
  include: { user: true };
}>;

// Data access for sessions. Only token hashes are stored; the raw token
// never reaches the database.
@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateSessionData): Promise<Session> {
    return this.prisma.session.create({
      data: {
        tokenHash: data.tokenHash,
        userId: data.userId,
        expiresAt: data.expiresAt,
      },
    });
  }

  findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    return this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  // deleteMany so a missing session is a no-op instead of a P2025 error.
  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  }
}
