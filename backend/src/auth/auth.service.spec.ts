import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import type { User } from '../generated/prisma/client.js';
import {
  ARGON2_OPTIONS,
  UsersService,
} from '../modules/users/users.service.js';
import { AuthService } from './auth.service.js';
import { SESSION_TTL_MS } from './session.constants.js';
import { SessionsRepository } from './sessions.repository.js';

// The ESM namespace of `argon2` is not spy-able with vi.spyOn, so the module
// is replaced by pass-through spies: real hashing/verification still runs,
// but calls can be asserted (e.g. the dummy-hash verify on unknown emails).
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  const hash = vi.fn(actual.hash);
  const verify = vi.fn(actual.verify);
  return { ...actual, hash, verify, default: { ...actual, hash, verify } };
});

const PASSWORD = 'correct horse battery staple';
const PUBLIC_USER = { id: 'user-1', email: 'user@example.test' };
const NOW = new Date('2026-06-01T12:00:00.000Z');

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function makeUser(passwordHash: string): User {
  return {
    ...PUBLIC_USER,
    passwordHash,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let storedHash: string;

  const usersService = {
    create: vi.fn(),
    findByEmail: vi.fn(),
    toPublicUser: vi.fn((user: User) => ({ id: user.id, email: user.email })),
  };
  const sessionsRepository = {
    create: vi.fn(),
    findByTokenHash: vi.fn(),
    deleteByTokenHash: vi.fn(),
    deleteExpired: vi.fn(),
  };

  beforeAll(async () => {
    storedHash = await argon2.hash(PASSWORD, ARGON2_OPTIONS);
  });

  beforeEach(async () => {
    usersService.create.mockReset();
    usersService.findByEmail.mockReset();
    usersService.toPublicUser.mockClear();
    for (const fn of Object.values(sessionsRepository)) {
      fn.mockReset();
      fn.mockResolvedValue(undefined);
    }
    vi.mocked(argon2.verify).mockClear();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: SessionsRepository, useValue: sessionsRepository },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('returns a base64url token of 32 random bytes', async () => {
      const { token } = await service.createSession('user-1');

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    });

    it('issues a different token each time', async () => {
      const a = await service.createSession('user-1');
      const b = await service.createSession('user-1');

      expect(a.token).not.toBe(b.token);
    });

    it('stores the sha256 hex of the token, never the token itself', async () => {
      const { token } = await service.createSession('user-1');

      expect(sessionsRepository.create).toHaveBeenCalledTimes(1);
      const data = sessionsRepository.create.mock.calls[0][0] as {
        tokenHash: string;
        userId: string;
        expiresAt: Date;
      };
      expect(data.tokenHash).toBe(sha256(token));
      expect(data.tokenHash).not.toBe(token);
      expect(data.userId).toBe('user-1');
    });

    it('expires the session exactly 7 days from now', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);

      const { expiresAt } = await service.createSession('user-1');

      const expected = NOW.getTime() + 7 * 24 * 60 * 60 * 1000;
      expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(expiresAt.getTime()).toBe(expected);
      expect(sessionsRepository.create.mock.calls[0][0].expiresAt).toEqual(
        new Date(expected),
      );
    });

    it('cleans up expired sessions', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);

      await service.createSession('user-1');

      expect(sessionsRepository.deleteExpired).toHaveBeenCalledWith(NOW);
    });
  });

  describe('validateSession', () => {
    it.each([undefined, ''])(
      'returns null for token %j without touching the repository',
      async (token) => {
        await expect(service.validateSession(token)).resolves.toBeNull();
        expect(sessionsRepository.findByTokenHash).not.toHaveBeenCalled();
      },
    );

    it('returns null for an unknown token (looked up by hash)', async () => {
      sessionsRepository.findByTokenHash.mockResolvedValue(null);

      await expect(service.validateSession('unknown')).resolves.toBeNull();
      expect(sessionsRepository.findByTokenHash).toHaveBeenCalledWith(
        sha256('unknown'),
      );
    });

    it.each([
      ['exactly at expiry', 0],
      ['after expiry', -1000],
    ])(
      'deletes the session and returns null when %s',
      async (_label, offset) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        sessionsRepository.findByTokenHash.mockResolvedValue({
          expiresAt: new Date(NOW.getTime() + offset),
          user: makeUser(storedHash),
        });

        await expect(service.validateSession('tok')).resolves.toBeNull();
        expect(sessionsRepository.deleteByTokenHash).toHaveBeenCalledWith(
          sha256('tok'),
        );
      },
    );

    it('returns only { id, email } for a valid session', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      sessionsRepository.findByTokenHash.mockResolvedValue({
        expiresAt: new Date(NOW.getTime() + 1000),
        user: makeUser(storedHash),
      });

      const result = await service.validateSession('tok');

      expect(result).toEqual(PUBLIC_USER);
      expect(Object.keys(result ?? {}).sort()).toEqual(['email', 'id']);
      expect(sessionsRepository.deleteByTokenHash).not.toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it("deletes the session by the token's hash", async () => {
      await service.revokeSession('tok');

      expect(sessionsRepository.deleteByTokenHash).toHaveBeenCalledWith(
        sha256('tok'),
      );
    });

    it('is a no-op without a token', async () => {
      await service.revokeSession(undefined);

      expect(sessionsRepository.deleteByTokenHash).not.toHaveBeenCalled();
    });
  });

  describe('signUp', () => {
    it('creates the user, then a session for it', async () => {
      usersService.create.mockResolvedValue(PUBLIC_USER);

      const result = await service.signUp('user@example.test', PASSWORD);

      expect(usersService.create).toHaveBeenCalledWith(
        'user@example.test',
        PASSWORD,
      );
      expect(result.user).toEqual(PUBLIC_USER);
      expect(sessionsRepository.create).toHaveBeenCalledTimes(1);
      expect(sessionsRepository.create.mock.calls[0][0].userId).toBe('user-1');
      expect(sessionsRepository.create.mock.calls[0][0].tokenHash).toBe(
        sha256(result.session.token),
      );
    });

    it('propagates a ConflictException and creates no session', async () => {
      usersService.create.mockRejectedValue(
        new ConflictException('Email is already registered'),
      );

      await expect(
        service.signUp('user@example.test', PASSWORD),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sessionsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    beforeEach(async () => {
      // The dummy hash for unknown emails is computed here.
      await service.onModuleInit();
      vi.mocked(argon2.verify).mockClear();
    });

    it('returns a fresh session and only { id, email } on success', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser(storedHash));

      const result = await service.signIn('user@example.test', PASSWORD);

      expect(result.user).toEqual(PUBLIC_USER);
      expect(Object.keys(result.user).sort()).toEqual(['email', 'id']);
      expect(result.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(sessionsRepository.create).toHaveBeenCalledTimes(1);
      expect(sessionsRepository.create.mock.calls[0][0].tokenHash).toBe(
        sha256(result.session.token),
      );
    });

    it('rejects a wrong password with a generic 401 and creates no session', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser(storedHash));

      const promise = service.signIn('user@example.test', 'wrong password');

      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(promise).rejects.toThrow('Invalid email or password');
      expect(argon2.verify).toHaveBeenCalledWith(storedHash, 'wrong password');
      expect(sessionsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown email identically, still running argon2.verify on the dummy hash', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const promise = service.signIn('nobody@example.test', PASSWORD);

      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(promise).rejects.toThrow('Invalid email or password');
      expect(argon2.verify).toHaveBeenCalledTimes(1);
      const [hash, password] = vi.mocked(argon2.verify).mock.calls[0];
      // A real argon2id hash with the same cost parameters as user hashes,
      // so the unknown-email path costs the same as a wrong password.
      expect(hash.startsWith('$argon2id$v=19$m=19456')).toBe(true);
      expect(hash.split('$').slice(0, 4)).toEqual(
        storedHash.split('$').slice(0, 4),
      );
      expect(hash).not.toBe(storedHash);
      expect(password).toBe(PASSWORD);
      expect(sessionsRepository.create).not.toHaveBeenCalled();
    });
  });
});
