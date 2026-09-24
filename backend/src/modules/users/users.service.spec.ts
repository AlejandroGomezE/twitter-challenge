import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

const PASSWORD = 'correct horse battery staple';
const CREATED_AT = new Date('2026-01-01T00:00:00Z');

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.test',
    username: 'someone',
    bio: null,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function prismaError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma failure', {
    code,
    clientVersion: 'test',
    meta,
  });
}

// P2002 as Prisma 7 reports it through the better-sqlite3 driver adapter
// (observed shape: no `meta.target`).
function adapterUniqueViolation(
  field: string,
): Prisma.PrismaClientKnownRequestError {
  return prismaError('P2002', {
    modelName: 'User',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: 'SQLITE_CONSTRAINT_UNIQUE',
        originalMessage: `UNIQUE constraint failed: User.${field}`,
        kind: 'UniqueConstraintViolation',
        constraint: { fields: [field] },
        table: 'User',
      },
    },
  });
}

describe('UsersService', () => {
  let service: UsersService;
  const repository = {
    create: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    findByUsername: vi.fn(),
    updateProfile: vi.fn(),
  };

  beforeEach(async () => {
    for (const fn of Object.values(repository)) {
      fn.mockReset();
    }
    // Echo the stored data back as a full record, like Prisma would.
    repository.create.mockImplementation(
      (data: { email: string; username: string; passwordHash: string }) =>
        Promise.resolve(makeUser(data)),
    );
    repository.updateProfile.mockImplementation(
      (_id: string, data: { username?: string; bio?: string | null }) =>
        Promise.resolve(
          makeUser({
            ...(data.username !== undefined && { username: data.username }),
            ...(data.bio !== undefined && { bio: data.bio }),
          }),
        ),
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
    it('normalizes the email and username (trim + lowercase) before storing them', async () => {
      await service.create('  User@Example.TEST ', '  Some_One ', PASSWORD);

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(repository.create.mock.calls[0][0].email).toBe(
        'user@example.test',
      );
      expect(repository.create.mock.calls[0][0].username).toBe('some_one');
    });

    it('stores an argon2id hash of the password, never the plaintext', async () => {
      await service.create('user@example.test', 'someone', PASSWORD);

      const data = repository.create.mock.calls[0][0] as {
        email: string;
        username: string;
        passwordHash: string;
      };
      expect(Object.keys(data).sort()).toEqual([
        'email',
        'passwordHash',
        'username',
      ]);
      expect(data.passwordHash).not.toBe(PASSWORD);
      expect(data.passwordHash).not.toContain(PASSWORD);
      expect(data.passwordHash.startsWith('$argon2id$v=19$m=19456')).toBe(true);
      await expect(argon2.verify(data.passwordHash, PASSWORD)).resolves.toBe(
        true,
      );
    });

    it('returns only { id, email, username }', async () => {
      const result = await service.create(
        'user@example.test',
        'someone',
        PASSWORD,
      );

      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.test',
        username: 'someone',
      });
      expect(Object.keys(result).sort()).toEqual(['email', 'id', 'username']);
    });

    it('produces a different hash for the same password on each call (random salt)', async () => {
      await service.create('a@example.test', 'user_a', PASSWORD);
      await service.create('b@example.test', 'user_b', PASSWORD);

      const first = repository.create.mock.calls[0][0].passwordHash as string;
      const second = repository.create.mock.calls[1][0].passwordHash as string;
      expect(first).not.toBe(second);
    });

    it.each([
      ['email', 'Email is already registered'],
      ['username', 'Username is already taken'],
    ])(
      'maps a driver-adapter P2002 on %s to a ConflictException',
      async (field, message) => {
        repository.create.mockRejectedValue(adapterUniqueViolation(field));

        const promise = service.create(
          'user@example.test',
          'someone',
          PASSWORD,
        );
        await expect(promise).rejects.toBeInstanceOf(ConflictException);
        await expect(promise).rejects.toThrow(message);
        expect(repository.findByEmail).not.toHaveBeenCalled();
      },
    );

    it.each([
      [['email'], 'Email is already registered'],
      [['username'], 'Username is already taken'],
    ])(
      'maps a P2002 with meta.target %j to a ConflictException',
      async (target, message) => {
        repository.create.mockRejectedValue(prismaError('P2002', { target }));

        await expect(
          service.create('user@example.test', 'someone', PASSWORD),
        ).rejects.toThrow(message);
      },
    );

    it.each([
      ['an existing', makeUser(), 'Email is already registered'],
      ['no', null, 'Username is already taken'],
    ])(
      'without field info on the P2002, looks up the email (%s account)',
      async (_label, existing, message) => {
        repository.create.mockRejectedValue(prismaError('P2002'));
        repository.findByEmail.mockResolvedValue(existing);

        const promise = service.create(
          ' USER@example.test',
          'someone',
          PASSWORD,
        );
        await expect(promise).rejects.toBeInstanceOf(ConflictException);
        await expect(promise).rejects.toThrow(message);
        expect(repository.findByEmail).toHaveBeenCalledWith(
          'user@example.test',
        );
      },
    );

    it('rethrows other Prisma errors unchanged', async () => {
      const error = prismaError('P2003');
      repository.create.mockRejectedValue(error);

      await expect(
        service.create('user@example.test', 'someone', PASSWORD),
      ).rejects.toBe(error);
    });

    it('rethrows non-Prisma errors unchanged', async () => {
      const error = new Error('connection lost');
      repository.create.mockRejectedValue(error);

      await expect(
        service.create('user@example.test', 'someone', PASSWORD),
      ).rejects.toBe(error);
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
    it('returns only { id, email, username } for an existing user', async () => {
      repository.findById.mockResolvedValue(makeUser({ bio: 'hello' }));

      const result = await service.findById('user-1');

      expect(repository.findById).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.test',
        username: 'someone',
      });
      expect(Object.keys(result ?? {}).sort()).toEqual([
        'email',
        'id',
        'username',
      ]);
    });

    it('returns null when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('missing')).resolves.toBeNull();
    });
  });

  describe('getProfile', () => {
    it('looks the username up normalized and returns only { username, bio, createdAt }', async () => {
      repository.findByUsername.mockResolvedValue(makeUser({ bio: 'hello' }));

      const result = await service.getProfile('  SomeOne ');

      expect(repository.findByUsername).toHaveBeenCalledWith('someone');
      expect(result).toEqual({
        username: 'someone',
        bio: 'hello',
        createdAt: CREATED_AT,
      });
      expect(Object.keys(result).sort()).toEqual([
        'bio',
        'createdAt',
        'username',
      ]);
    });

    it('throws NotFoundException for an unknown username', async () => {
      repository.findByUsername.mockResolvedValue(null);

      const promise = service.getProfile('nobody');
      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('User not found');
    });
  });

  describe('updateProfile', () => {
    it('updates the caller row with the normalized values and returns the full own view', async () => {
      const result = await service.updateProfile('user-1', {
        username: ' New_Name ',
        bio: '  hello there  ',
      });

      expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
        username: 'new_name',
        bio: 'hello there',
      });
      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.test',
        username: 'new_name',
        bio: 'hello there',
        createdAt: CREATED_AT,
      });
      expect(Object.keys(result).sort()).toEqual([
        'bio',
        'createdAt',
        'email',
        'id',
        'username',
      ]);
    });

    it.each([
      ['an empty string', ''],
      ['whitespace', '   '],
      ['null', null],
    ])('clears the bio when given %s', async (_label, bio) => {
      await service.updateProfile('user-1', { bio });

      expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
        bio: null,
      });
    });

    it('only writes the fields that were provided', async () => {
      await service.updateProfile('user-1', { username: 'other' });

      expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
        username: 'other',
      });
    });

    it('treats re-setting your own current username as a normal update, not a conflict', async () => {
      await expect(
        service.updateProfile('user-1', { username: 'SomeOne' }),
      ).resolves.toMatchObject({ username: 'someone' });
    });

    it('maps a P2002 to a ConflictException for the username', async () => {
      repository.updateProfile.mockRejectedValue(
        adapterUniqueViolation('username'),
      );

      const promise = service.updateProfile('user-1', { username: 'taken' });
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow('Username is already taken');
    });

    it('maps a P2025 (caller no longer exists) to a NotFoundException', async () => {
      repository.updateProfile.mockRejectedValue(prismaError('P2025'));

      const promise = service.updateProfile('gone', { bio: 'x' });
      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('User not found');
    });

    it('rethrows other errors unchanged', async () => {
      const error = new Error('connection lost');
      repository.updateProfile.mockRejectedValue(error);

      await expect(service.updateProfile('user-1', { bio: 'x' })).rejects.toBe(
        error,
      );
    });
  });

  describe('toPublicUser', () => {
    it('never includes passwordHash (or any other field)', () => {
      const result = service.toPublicUser(makeUser({ bio: 'hello' }));

      expect(result).not.toHaveProperty('passwordHash');
      expect(Object.keys(result).sort()).toEqual(['email', 'id', 'username']);
    });
  });
});
