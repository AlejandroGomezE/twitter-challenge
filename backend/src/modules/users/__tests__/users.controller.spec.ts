import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { PostPageResponseDto } from '../../posts/dto/post-page-response.dto.js';
import { MyProfileResponseDto } from '../dto/my-profile-response.dto.js';
import { ProfileResponseDto } from '../dto/profile-response.dto.js';
import { UsersController } from '../users.controller.js';
import { UsersService } from '../users.service.js';

// Metadata key set by @SerializeOptions(). Nest does not export it from the
// @nestjs/common entry point (CLASS_SERIALIZER_OPTIONS), so it is mirrored.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';

const CALLER = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'someone',
};
const CREATED_AT = new Date('2026-01-02T03:04:05.678Z');
const PROFILE = {
  username: 'other',
  bio: 'hi',
  createdAt: CREATED_AT,
  postCount: 2,
  followerCount: 3,
  followingCount: 1,
  isFollowing: true,
  followsYou: false,
};
const MY_PROFILE = {
  ...CALLER,
  bio: 'new bio',
  createdAt: CREATED_AT,
  postCount: 0,
  followerCount: 0,
  followingCount: 0,
};
const PAGE = { items: [], nextCursor: null };

type Handler = 'getProfile' | 'updateMe' | 'listPosts';

function handlerOf(name: Handler): (...args: unknown[]) => unknown {
  return (
    UsersController.prototype as unknown as Record<
      Handler,
      (...args: unknown[]) => unknown
    >
  )[name];
}

describe('UsersController', () => {
  let controller: UsersController;

  const usersService = {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    listPosts: vi.fn(),
  };

  beforeEach(async () => {
    usersService.getProfile.mockReset();
    usersService.updateProfile.mockReset();
    usersService.listPosts.mockReset();
    usersService.getProfile.mockResolvedValue(PROFILE);
    usersService.updateProfile.mockResolvedValue(MY_PROFILE);
    usersService.listPosts.mockResolvedValue(PAGE);

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();
    controller = moduleRef.get(UsersController);
  });

  describe('getProfile', () => {
    it('passes the route param and the session user as viewer to the service and returns the profile', async () => {
      await expect(controller.getProfile(CALLER, 'Other')).resolves.toBe(
        PROFILE,
      );
      expect(usersService.getProfile).toHaveBeenCalledWith('Other', CALLER.id);
    });
  });

  describe('listPosts', () => {
    it('passes the route param, the session user as viewer and the query to the service', async () => {
      await expect(
        controller.listPosts(CALLER, 'Other', { cursor: 'abc', limit: 5 }),
      ).resolves.toBe(PAGE);
      expect(usersService.listPosts).toHaveBeenCalledWith('Other', CALLER.id, {
        cursor: 'abc',
        limit: 5,
      });
    });
  });

  describe('updateMe', () => {
    it("updates the session user's profile with the body fields", async () => {
      await expect(
        controller.updateMe(CALLER, { username: 'renamed', bio: 'new bio' }),
      ).resolves.toBe(MY_PROFILE);
      expect(usersService.updateProfile).toHaveBeenCalledWith(CALLER.id, {
        username: 'renamed',
        bio: 'new bio',
      });
    });

    it('takes the target id only from @CurrentUser(), never from the body', async () => {
      const body = { bio: 'x', id: 'user-2', userId: 'user-2' };

      await controller.updateMe(CALLER, body);

      expect(usersService.updateProfile).toHaveBeenCalledTimes(1);
      expect(usersService.updateProfile).toHaveBeenCalledWith(CALLER.id, {
        username: undefined,
        bio: 'x',
      });
    });
  });

  describe('declared metadata', () => {
    const reflector = new Reflector();

    it.each([
      ['getProfile', ProfileResponseDto],
      ['updateMe', MyProfileResponseDto],
      ['listPosts', PostPageResponseDto],
    ] as const)('%s serializes through its response DTO', (name, type) => {
      expect(
        reflector.get<{ type?: unknown }>(
          SERIALIZE_OPTIONS_KEY,
          handlerOf(name),
        ),
      ).toEqual({ type });
    });

    it.each(['getProfile', 'updateMe', 'listPosts'] as const)(
      '%s is not @Public()',
      (name) => {
        expect(reflector.get(IS_PUBLIC_KEY, handlerOf(name))).toBeUndefined();
      },
    );

    it('is not @Public() at the controller level', () => {
      expect(reflector.get(IS_PUBLIC_KEY, UsersController)).toBeUndefined();
    });
  });
});
