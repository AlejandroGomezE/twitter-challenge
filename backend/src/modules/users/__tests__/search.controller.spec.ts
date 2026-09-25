import { PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { FollowUserPageResponseDto } from '../../follows/dto/follow-user-page-response.dto.js';
import { SearchController } from '../search.controller.js';
import { UsersService } from '../users.service.js';

// Metadata key set by @SerializeOptions(). Nest does not export it from the
// @nestjs/common entry point (CLASS_SERIALIZER_OPTIONS), so it is mirrored.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';

const CALLER = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'someone',
};
const PAGE = { items: [], nextCursor: null };

const handler = SearchController.prototype.searchUsers as (
  ...args: unknown[]
) => unknown;

describe('SearchController', () => {
  let controller: SearchController;

  const usersService = { searchUsers: vi.fn() };

  beforeEach(async () => {
    usersService.searchUsers.mockReset();
    usersService.searchUsers.mockResolvedValue(PAGE);

    const moduleRef = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();
    controller = moduleRef.get(SearchController);
  });

  it('passes the session user as viewer, the query and the paging to the service', async () => {
    await expect(
      controller.searchUsers(CALLER, { q: 'ada', cursor: 'abc', limit: 5 }),
    ).resolves.toBe(PAGE);
    expect(usersService.searchUsers).toHaveBeenCalledWith(CALLER.id, 'ada', {
      cursor: 'abc',
      limit: 5,
    });
  });

  describe('declared metadata', () => {
    const reflector = new Reflector();

    it('is mounted at GET /search/users', () => {
      expect(reflector.get(PATH_METADATA, SearchController)).toBe('search');
      expect(reflector.get(PATH_METADATA, handler)).toBe('users');
    });

    it('serializes through the follow-user page DTO', () => {
      expect(
        reflector.get<{ type?: unknown }>(SERIALIZE_OPTIONS_KEY, handler),
      ).toEqual({ type: FollowUserPageResponseDto });
    });

    it('is not @Public()', () => {
      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, SearchController)).toBeUndefined();
    });
  });
});
