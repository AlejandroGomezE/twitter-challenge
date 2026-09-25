import {
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import {
  ARGON2_OPTIONS,
  type PublicUser,
  UsersService,
} from '../modules/users/users.service.js';
import { SESSION_TTL_MS } from './session.constants.js';
import { SessionsRepository } from './sessions.repository.js';

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  session: CreatedSession;
}

const SESSION_TOKEN_BYTES = 32;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const DUMMY_SECRET_BYTES = 32;

@Injectable()
export class AuthService implements OnModuleInit {
  // Hash of a random secret, verified against when the email is unknown so
  // that sign-in takes the same time whether or not the account exists.
  // Computed eagerly at module init (before the app serves requests) so the
  // first unknown-email sign-in is not slower than later ones.
  private dummyHash: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsRepository: SessionsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(
      randomBytes(DUMMY_SECRET_BYTES).toString('base64url'),
      ARGON2_OPTIONS,
    );
  }

  // Throws 409 (from UsersService) when the email is already registered or
  // the username is already taken.
  async signUp(
    email: string,
    username: string,
    displayName: string,
    password: string,
  ): Promise<AuthResult> {
    const user = await this.usersService.create(
      email,
      username,
      displayName,
      password,
    );
    const session = await this.createSession(user.id);
    return { user, session };
  }

  // Unknown email and wrong password fail identically (same status, same
  // message, comparable timing) to avoid account enumeration.
  async signIn(email: string, password: string): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      await argon2.verify(this.dummyHash, password);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const session = await this.createSession(user.id);
    return { user: this.usersService.toPublicUser(user), session };
  }

  // Issues a new session with an absolute expiry. Returns the raw token,
  // which must only ever be sent to the client in the session cookie.
  async createSession(userId: string): Promise<CreatedSession> {
    const now = new Date();
    // Opportunistic cleanup so the table does not grow unbounded.
    await this.sessionsRepository.deleteExpired(now);

    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.sessionsRepository.create({
      tokenHash: this.hashToken(token),
      userId,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async validateSession(token?: string): Promise<PublicUser | null> {
    if (!token) {
      return null;
    }
    const tokenHash = this.hashToken(token);
    const session = await this.sessionsRepository.findByTokenHash(tokenHash);
    if (!session) {
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessionsRepository.deleteByTokenHash(tokenHash);
      return null;
    }
    return this.usersService.toPublicUser(session.user);
  }

  // Idempotent: revoking a missing or unknown token is a no-op.
  async revokeSession(token?: string): Promise<void> {
    if (!token) {
      return;
    }
    await this.sessionsRepository.deleteByTokenHash(this.hashToken(token));
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
