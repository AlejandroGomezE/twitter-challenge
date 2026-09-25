import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Prisma, type User } from '../../../generated/prisma/client.js';
import { FollowsService } from '../../follows/follows.service.js';
import { PostsService } from '../../posts/posts.service.js';
import { UsersRepository } from '../users.repository.js';
import { UsersService } from '../users.service.js';

const PASSWORD = 'correct horse battery staple';
const CREATED_AT = new Date('2026-01-01T00:00:00Z');

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.test',
    username: 'someone',
    displayName: null,
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
    searchPage: vi.fn(),
  };
  const postsService = {
    countByAuthor: vi.fn(),
    listByAuthor: vi.fn(),
  };
  const followsService = {
    counts: vi.fn(),
    relation: vi.fn(),
    relationsFor: vi.fn(),
  };

  beforeEach(async () => {
    for (const fn of [
      ...Object.values(repository),
      ...Object.values(postsService),
      ...Object.values(followsService),
    ]) {
      fn.mockReset();
    }
    postsService.countByAuthor.mockResolvedValue(4);
    followsService.counts.mockResolvedValue({
      followerCount: 2,
      followingCount: 3,
    });
    followsService.relation.mockResolvedValue({
      isFollowing: true,
      followsYou: false,
    });
    // Echo the stored data back as a full record, like Prisma would.
    repository.create.mockImplementation(
      (data: {
        email: string;
        username: string;
        displayName: string;
        passwordHash: string;
      }) => Promise.resolve(makeUser(data)),
    );
    repository.updateProfile.mockImplementation(
      (
        _id: string,
        data: { username?: string; bio?: string | null; displayName?: string },
      ) =>
        Promise.resolve(
          makeUser({
            ...(data.username !== undefined && { username: data.username }),
            ...(data.bio !== undefined && { bio: data.bio }),
            ...(data.displayName !== undefined && {
              displayName: data.displayName,
            }),
          }),
        ),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: PostsService, useValue: postsService },
        { provide: FollowsService, useValue: followsService },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('normalizes the email and username (trim + lowercase) and trims the display name before storing them', async () => {
      await service.create(
        '  User@Example.TEST ',
        '  Some_One ',
        '  Ada Lovelace  ',
        PASSWORD,
      );

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(repository.create.mock.calls[0][0].email).toBe(
        'user@example.test',
      );
      expect(repository.create.mock.calls[0][0].username).toBe('some_one');
      expect(repository.create.mock.calls[0][0].displayName).toBe(
        'Ada Lovelace',
      );
    });

    it('stores an argon2id hash of the password, never the plaintext', async () => {
      await service.create(
        'user@example.test',
        'someone',
        'Some One',
        PASSWORD,
      );

      const data = repository.create.mock.calls[0][0] as {
        email: string;
        username: string;
        passwordHash: string;
      };
      expect(Object.keys(data).sort()).toEqual([
        'displayName',
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

    it('returns only { id, email, username, displayName }', async () => {
      const result = await service.create(
        'user@example.test',
        'someone',
        'Some One',
        PASSWORD,
      );

      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.test',
        username: 'someone',
        displayName: 'Some One',
      });
      expect(Object.keys(result).sort()).toEqual([
        'displayName',
        'email',
        'id',
        'username',
      ]);
    });

    it('produces a different hash for the same password on each call (random salt)', async () => {
      await service.create('a@example.test', 'user_a', 'Some One', PASSWORD);
      await service.create('b@example.test', 'user_b', 'Some One', PASSWORD);

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
          'Some One',
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
          service.create('user@example.test', 'someone', 'Some One', PASSWORD),
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
          'Some One',
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
        service.create('user@example.test', 'someone', 'Some One', PASSWORD),
      ).rejects.toBe(error);
    });

    it('rethrows non-Prisma errors unchanged', async () => {
      const error = new Error('connection lost');
      repository.create.mockRejectedValue(error);

      await expect(
        service.create('user@example.test', 'someone', 'Some One', PASSWORD),
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
    it('returns only { id, email, username, displayName } for an existing user', async () => {
      repository.findById.mockResolvedValue(makeUser({ bio: 'hello' }));

      const result = await service.findById('user-1');

      expect(repository.findById).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.test',
        username: 'someone',
        displayName: null,
      });
      expect(Object.keys(result ?? {}).sort()).toEqual([
        'displayName',
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
    it('looks the username up normalized and returns the profile with counts and the relation to the viewer', async () => {
      repository.findByUsername.mockResolvedValue(
        makeUser({ bio: 'hello', displayName: 'Some One' }),
      );

      const result = await service.getProfile('  SomeOne ', 'viewer-1');

      expect(repository.findByUsername).toHaveBeenCalledWith('someone');
      // One call each: a constant number of queries per profile.
      expect(postsService.countByAuthor).toHaveBeenCalledTimes(1);
      expect(postsService.countByAuthor).toHaveBeenCalledWith('user-1');
      expect(followsService.counts).toHaveBeenCalledTimes(1);
      expect(followsService.counts).toHaveBeenCalledWith('user-1');
      expect(followsService.relation).toHaveBeenCalledTimes(1);
      expect(followsService.relation).toHaveBeenCalledWith(
        'viewer-1',
        'user-1',
      );
      expect(result).toEqual({
        username: 'someone',
        displayName: 'Some One',
        bio: 'hello',
        createdAt: CREATED_AT,
        postCount: 4,
        followerCount: 2,
        followingCount: 3,
        isFollowing: true,
        followsYou: false,
      });
      expect(Object.keys(result).sort()).toEqual([
        'bio',
        'createdAt',
        'displayName',
        'followerCount',
        'followingCount',
        'followsYou',
        'isFollowing',
        'postCount',
        'username',
      ]);
    });

    it('runs the post count, follow counts and relation concurrently', async () => {
      repository.findByUsername.mockResolvedValue(makeUser());
      // None of these settle until released, so a sequential await would
      // leave only the first one started.
      const started: string[] = [];
      const releases: Array<() => void> = [];
      const pending = <T>(name: string, value: T) =>
        new Promise<T>((resolve) => {
          started.push(name);
          releases.push(() => resolve(value));
        });
      postsService.countByAuthor.mockImplementation(() => pending('posts', 1));
      followsService.counts.mockImplementation(() =>
        pending('counts', { followerCount: 0, followingCount: 0 }),
      );
      followsService.relation.mockImplementation(() =>
        pending('relation', { isFollowing: false, followsYou: false }),
      );

      const promise = service.getProfile('someone', 'viewer-1');
      await vi.waitFor(() => expect(started.length).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect([...started].sort()).toEqual(['counts', 'posts', 'relation']);
      releases.forEach((release) => release());
      await expect(promise).resolves.toMatchObject({ postCount: 1 });
    });

    it('returns displayName: null for a user who never set one', async () => {
      repository.findByUsername.mockResolvedValue(makeUser());

      await expect(
        service.getProfile('someone', 'viewer-1'),
      ).resolves.toMatchObject({ displayName: null });
    });

    it("passes the viewer's own id through when viewing your own profile (relation is false/false)", async () => {
      repository.findByUsername.mockResolvedValue(makeUser());
      followsService.relation.mockResolvedValue({
        isFollowing: false,
        followsYou: false,
      });

      const result = await service.getProfile('someone', 'user-1');

      expect(followsService.relation).toHaveBeenCalledWith('user-1', 'user-1');
      expect(result).toMatchObject({ isFollowing: false, followsYou: false });
    });

    it('throws NotFoundException for an unknown username', async () => {
      repository.findByUsername.mockResolvedValue(null);

      const promise = service.getProfile('nobody', 'viewer-1');
      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('User not found');
      expect(postsService.countByAuthor).not.toHaveBeenCalled();
      expect(followsService.counts).not.toHaveBeenCalled();
      expect(followsService.relation).not.toHaveBeenCalled();
    });
  });

  describe('listPosts', () => {
    it("resolves the username (normalized) and pages that user's posts for the viewer", async () => {
      const page = { items: [], nextCursor: null };
      repository.findByUsername.mockResolvedValue(makeUser());
      postsService.listByAuthor.mockResolvedValue(page);

      await expect(
        service.listPosts(' SomeOne', 'viewer-1', { cursor: 'abc', limit: 5 }),
      ).resolves.toBe(page);

      expect(repository.findByUsername).toHaveBeenCalledWith('someone');
      expect(postsService.listByAuthor).toHaveBeenCalledWith(
        'user-1',
        'viewer-1',
        { cursor: 'abc', limit: 5 },
      );
    });

    it('throws 404 User not found for an unknown username', async () => {
      repository.findByUsername.mockResolvedValue(null);

      const promise = service.listPosts('nobody', 'viewer-1', {});
      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('User not found');
      expect(postsService.listByAuthor).not.toHaveBeenCalled();
    });
  });

  describe('searchUsers', () => {
    const NO_RELATIONS = {
      followedByViewer: new Set<string>(),
      followingViewer: new Set<string>(),
    };

    function row(username: string) {
      return {
        id: `id-${username}`,
        username,
        displayName: `Name ${username}`,
        bio: null,
      };
    }

    function cursorFor(username: string): string {
      return Buffer.from(JSON.stringify([username]), 'utf8').toString(
        'base64url',
      );
    }

    beforeEach(() => {
      repository.searchPage.mockResolvedValue([]);
      followsService.relationsFor.mockResolvedValue(NO_RELATIONS);
    });

    it('reads the first page with the default size (20) and no cursor', async () => {
      await expect(service.searchUsers('viewer-1', 'ada', {})).resolves.toEqual(
        { items: [], nextCursor: null },
      );
      expect(repository.searchPage).toHaveBeenCalledWith({
        query: 'ada',
        afterUsername: undefined,
        limit: 20,
      });
    });

    it('returns `limit` items and a cursor on the last one when there are more', async () => {
      repository.searchPage.mockResolvedValue(['ann', 'bea', 'cid'].map(row));

      const page = await service.searchUsers('viewer-1', 'a', { limit: 2 });

      expect(repository.searchPage).toHaveBeenCalledWith({
        query: 'a',
        afterUsername: undefined,
        limit: 2,
      });
      expect(page.items.map((item) => item.username)).toEqual(['ann', 'bea']);
      expect(page.nextCursor).toBe(cursorFor('bea'));
    });

    it('has no next cursor on the last page', async () => {
      repository.searchPage.mockResolvedValue(['ann', 'bea'].map(row));

      const page = await service.searchUsers('viewer-1', 'a', { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('continues after the username in the cursor', async () => {
      await service.searchUsers('viewer-1', 'a', {
        cursor: cursorFor('bea'),
        limit: 2,
      });

      expect(repository.searchPage).toHaveBeenCalledWith({
        query: 'a',
        afterUsername: 'bea',
        limit: 2,
      });
    });

    it.each(['', '!!', cursorFor('')])(
      'rejects cursor %j with 400 Invalid cursor before any query',
      async (cursor) => {
        const promise = service.searchUsers('viewer-1', 'a', { cursor });
        await expect(promise).rejects.toBeInstanceOf(BadRequestException);
        await expect(promise).rejects.toThrow('Invalid cursor');
        expect(repository.searchPage).not.toHaveBeenCalled();
        expect(followsService.relationsFor).not.toHaveBeenCalled();
      },
    );

    it('computes the booleans for the whole page in one batch lookup and never exposes the id', async () => {
      repository.searchPage.mockResolvedValue(
        ['ann', 'bea', 'cid', 'me'].map(row),
      );
      followsService.relationsFor.mockResolvedValue({
        followedByViewer: new Set(['id-ann', 'id-bea']),
        followingViewer: new Set(['id-bea', 'id-cid']),
      });

      const page = await service.searchUsers('id-me', 'a', {});

      expect(followsService.relationsFor).toHaveBeenCalledTimes(1);
      expect(followsService.relationsFor).toHaveBeenCalledWith('id-me', [
        'id-ann',
        'id-bea',
        'id-cid',
        'id-me',
      ]);
      expect(page.items).toEqual([
        {
          username: 'ann',
          displayName: 'Name ann',
          bio: null,
          isFollowing: true,
          followsYou: false,
        },
        {
          username: 'bea',
          displayName: 'Name bea',
          bio: null,
          isFollowing: true,
          followsYou: true,
        },
        {
          username: 'cid',
          displayName: 'Name cid',
          bio: null,
          isFollowing: false,
          followsYou: true,
        },
        // The caller's own row: both false.
        {
          username: 'me',
          displayName: 'Name me',
          bio: null,
          isFollowing: false,
          followsYou: false,
        },
      ]);
    });

    it('only looks up relations for the rows it returns (not the extra row)', async () => {
      repository.searchPage.mockResolvedValue(['ann', 'bea'].map(row));

      await service.searchUsers('viewer-1', 'a', { limit: 1 });

      expect(followsService.relationsFor).toHaveBeenCalledWith('viewer-1', [
        'id-ann',
      ]);
    });
  });

  describe('updateProfile', () => {
    it('updates the caller row with the normalized values and returns the full own view', async () => {
      const result = await service.updateProfile('user-1', {
        username: ' New_Name ',
        bio: '  hello there  ',
        displayName: '  New Name  ',
      });

      expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
        username: 'new_name',
        bio: 'hello there',
        displayName: 'New Name',
      });
      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.test',
        username: 'new_name',
        displayName: 'New Name',
        bio: 'hello there',
        createdAt: CREATED_AT,
        postCount: 4,
        followerCount: 2,
        followingCount: 3,
      });
      expect(postsService.countByAuthor).toHaveBeenCalledWith('user-1');
      expect(followsService.counts).toHaveBeenCalledWith('user-1');
      expect(followsService.relation).not.toHaveBeenCalled();
      expect(Object.keys(result).sort()).toEqual([
        'bio',
        'createdAt',
        'displayName',
        'email',
        'followerCount',
        'followingCount',
        'id',
        'postCount',
        'username',
      ]);
    });

    it('reads the follow counts by user id, so a username change keeps them', async () => {
      const result = await service.updateProfile('user-1', {
        username: 'renamed',
      });

      expect(followsService.counts).toHaveBeenCalledWith('user-1');
      expect(result).toMatchObject({
        username: 'renamed',
        followerCount: 2,
        followingCount: 3,
      });
    });

    it('does not read counts when the update fails', async () => {
      repository.updateProfile.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.updateProfile('gone', { bio: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(followsService.counts).not.toHaveBeenCalled();
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

    it('sets the display name on its own, leaving the other fields untouched', async () => {
      const result = await service.updateProfile('user-1', {
        displayName: 'Ada',
      });

      expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
        displayName: 'Ada',
      });
      expect(result).toMatchObject({ displayName: 'Ada', username: 'someone' });
    });

    it('leaves the display name unchanged when it is omitted', async () => {
      await service.updateProfile('user-1', { bio: 'x' });

      expect(repository.updateProfile.mock.calls[0][1]).not.toHaveProperty(
        'displayName',
      );
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
      expect(Object.keys(result).sort()).toEqual([
        'displayName',
        'email',
        'id',
        'username',
      ]);
    });
  });
});
