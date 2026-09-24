import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

const PASSWORD = 'correct horse battery staple';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.test',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('UsersService', () => {
  let service: UsersService;
  const repository = {
    create: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
  };

  beforeEach(async () => {
    repository.create.mockReset();
    repository.findByEmail.mockReset();
    repository.findById.mockReset();
    // Echo the stored data back as a full record, like Prisma would.
    repository.create.mockImplementation(
      (data: { email: string; passwordHash: string }) =>
        Promise.resolve(makeUser(data)),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('normalizes the email (trim + lowercase) before storing it', async () => {
      await service.create('  User@Example.TEST ', PASSWORD);

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(repository.create.mock.calls[0][0].email).toBe(
        'user@example.test',
      );
    });

    it('stores an argon2id hash of the password, never the plaintext', async () => {
      await service.create('user@example.test', PASSWORD);

      const data = repository.create.mock.calls[0][0] as {
        email: string;
        passwordHash: string;
      };
      expect(Object.keys(data).sort()).toEqual(['email', 'passwordHash']);
      expect(data.passwordHash).not.toBe(PASSWORD);
      expect(data.passwordHash).not.toContain(PASSWORD);
      expect(data.passwordHash.startsWith('$argon2id$v=19$m=19456')).toBe(true);
      await expect(argon2.verify(data.passwordHash, PASSWORD)).resolves.toBe(
        true,
      );
    });

    it('returns only { id, email }', async () => {
      const result = await service.create('user@example.test', PASSWORD);

      expect(result).toEqual({ id: 'user-1', email: 'user@example.test' });
      expect(Object.keys(result).sort()).toEqual(['email', 'id']);
    });

    it('produces a different hash for the same password on each call (random salt)', async () => {
      await service.create('a@example.test', PASSWORD);
      await service.create('b@example.test', PASSWORD);

      const first = repository.create.mock.calls[0][0].passwordHash as string;
      const second = repository.create.mock.calls[1][0].passwordHash as string;
      expect(first).not.toBe(second);
    });

    it('maps a P2002 unique-constraint error to a ConflictException', async () => {
      repository.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const promise = service.create('user@example.test', PASSWORD);
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow('Email is already registered');
    });

    it('rethrows other Prisma errors unchanged', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Other failure', {
        code: 'P2003',
        clientVersion: 'test',
      });
      repository.create.mockRejectedValue(error);

      await expect(service.create('user@example.test', PASSWORD)).rejects.toBe(
        error,
      );
    });

    it('rethrows non-Prisma errors unchanged', async () => {
      const error = new Error('connection lost');
      repository.create.mockRejectedValue(error);

      await expect(service.create('user@example.test', PASSWORD)).rejects.toBe(
        error,
      );
    });
  });

  describe('findByEmail', () => {
    it('normalizes the email before querying', async () => {
      const user = makeUser();
      repository.findByEmail.mockResolvedValue(user);

      await expect(service.findByEmail('  USER@example.test ')).resolves.toBe(
        user,
      );
      expect(repository.findByEmail).toHaveBeenCalledWith('user@example.test');
    });
  });

  describe('findById', () => {
    it('returns only { id, email } for an existing user', async () => {
      repository.findById.mockResolvedValue(makeUser());

      const result = await service.findById('user-1');

      expect(repository.findById).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ id: 'user-1', email: 'user@example.test' });
      expect(Object.keys(result ?? {}).sort()).toEqual(['email', 'id']);
    });

    it('returns null when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('missing')).resolves.toBeNull();
    });
  });

  describe('toPublicUser', () => {
    it('never includes passwordHash (or any other field)', () => {
      const result = service.toPublicUser(makeUser());

      expect(result).not.toHaveProperty('passwordHash');
      expect(Object.keys(result).sort()).toEqual(['email', 'id']);
    });
  });
});
