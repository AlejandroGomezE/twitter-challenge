import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { containsPattern, UsersRepository } from '../users.repository.js';

// Checks the query handed to Prisma (mocked — no database). The real LIKE
// matching, escaping and keyset paging are exercised end-to-end
// (test/search.e2e-spec.ts).
describe('UsersRepository', () => {
  let repository: UsersRepository;

  const prisma = { $queryRaw: vi.fn() };

  // The single SQL statement searchPage sent, whitespace-collapsed.
  function sentQuery(): { sql: string; values: unknown[] } {
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const query = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query).toBeInstanceOf(Prisma.Sql);
    return { sql: query.sql.replace(/\s+/g, ' ').trim(), values: query.values };
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = moduleRef.get(UsersRepository);
  });

  describe('containsPattern', () => {
    it.each([
      ['ada', '%ada%'],
      ['_', '%!_%'],
      ['%', '%!%%'],
      ['50%_off!', '%50!%!_off!!%'],
      ['a\\b', '%a\\b%'],
    ])('%j -> %j', (value, expected) => {
      expect(containsPattern(value)).toBe(expected);
    });
  });

  describe('searchPage', () => {
    it('matches username OR displayName with an escaped LIKE, ordered by username, fetching limit + 1', async () => {
      const rows = [
        { id: 'u1', username: 'ada', displayName: null, bio: null },
      ];
      prisma.$queryRaw.mockResolvedValue(rows);

      await expect(
        repository.searchPage({ query: 'Ad_a', limit: 20 }),
      ).resolves.toBe(rows);

      const { sql, values } = sentQuery();
      expect(sql).toBe(
        'SELECT "id", "username", "displayName", "bio" FROM "User" ' +
          `WHERE ("username" LIKE ? ESCAPE '!' OR "displayName" LIKE ? ESCAPE '!') ` +
          'ORDER BY "username" ASC LIMIT ?',
      );
      expect(values).toEqual(['%Ad!_a%', '%Ad!_a%', 21]);
    });

    it('never selects the email or password hash', async () => {
      await repository.searchPage({ query: 'a', limit: 5 });

      const { sql } = sentQuery();
      expect(sql).not.toMatch(/email|passwordHash|\*/);
    });

    it('continues strictly after the cursor username', async () => {
      await repository.searchPage({
        query: 'a',
        afterUsername: 'bob',
        limit: 5,
      });

      const { sql, values } = sentQuery();
      expect(sql).toContain(
        `ESCAPE '!') AND "username" > ? ORDER BY "username" ASC LIMIT ?`,
      );
      expect(values).toEqual(['%a%', '%a%', 'bob', 6]);
    });
  });
});
