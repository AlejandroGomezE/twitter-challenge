import { HttpStatus, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { FollowStateResponseDto } from '../dto/follow-state-response.dto.js';
import { FollowUserListResponseDto } from '../dto/follow-user-list-response.dto.js';
import { FollowUserPageResponseDto } from '../dto/follow-user-page-response.dto.js';
import { FollowsController } from '../follows.controller.js';
import { FollowsService } from '../follows.service.js';

// Metadata keys set by @SerializeOptions(), @UseGuards(), @HttpCode() and the
// route decorators. Nest does not export them from the @nestjs/common entry
// point, so they are mirrored here.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';
const GUARDS_KEY = '__guards__';
const HTTP_CODE_KEY = '__httpCode__';
const PATH_KEY = 'path';
const METHOD_KEY = 'method';

const CALLER = { id: 'user-1', email: 'user@example.test', username: 'me_1' };

type Handler =
  'suggestions' | 'follow' | 'unfollow' | 'followers' | 'following';

function handlerOf(name: Handler): (...args: unknown[]) => unknown {
  return (
    FollowsController.prototype as unknown as Record<
      Handler,
      (...args: unknown[]) => unknown
    >
  )[name];
}

describe('FollowsController', () => {
  let controller: FollowsController;

  const followsService = {
    setFollowing: vi.fn(),
    listFollowers: vi.fn(),
    listFollowing: vi.fn(),
    suggestions: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [FollowsController],
      providers: [{ provide: FollowsService, useValue: followsService }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(FollowsController);
  });

  it('follow sets following=true as the session user', async () => {
    const state = { following: true, followerCount: 1 };
    followsService.setFollowing.mockResolvedValue(state);

    await expect(controller.follow(CALLER, 'Alice')).resolves.toBe(state);
    expect(followsService.setFollowing).toHaveBeenCalledWith(
      CALLER.id,
      'Alice',
      true,
    );
  });

  it('unfollow sets following=false as the session user', async () => {
    const state = { following: false, followerCount: 0 };
    followsService.setFollowing.mockResolvedValue(state);

    await expect(controller.unfollow(CALLER, 'alice')).resolves.toBe(state);
    expect(followsService.setFollowing).toHaveBeenCalledWith(
      CALLER.id,
      'alice',
      false,
    );
  });

  it.each([
    ['followers', 'listFollowers'],
    ['following', 'listFollowing'],
  ] as const)(
    '%s passes the page query and the viewer',
    async (name, method) => {
      const page = { items: [], nextCursor: null };
      followsService[method].mockResolvedValue(page);

      await expect(
        controller[name](CALLER, 'alice', { cursor: 'c', limit: 5 }),
      ).resolves.toBe(page);
      expect(followsService[method]).toHaveBeenCalledWith('alice', CALLER.id, {
        cursor: 'c',
        limit: 5,
      });
    },
  );

  it('suggestions passes the viewer and the limit', async () => {
    const list = { items: [] };
    followsService.suggestions.mockResolvedValue(list);

    await expect(controller.suggestions(CALLER, { limit: 7 })).resolves.toBe(
      list,
    );
    expect(followsService.suggestions).toHaveBeenCalledWith(CALLER.id, 7);
  });

  describe('declared metadata', () => {
    const reflector = new Reflector();

    it('is mounted under /users', () => {
      expect(reflector.get(PATH_KEY, FollowsController)).toBe('users');
    });

    it.each([
      [
        'suggestions',
        'me/suggestions',
        RequestMethod.GET,
        FollowUserListResponseDto,
      ],
      ['follow', ':username/follow', RequestMethod.PUT, FollowStateResponseDto],
      [
        'unfollow',
        ':username/follow',
        RequestMethod.DELETE,
        FollowStateResponseDto,
      ],
      [
        'followers',
        ':username/followers',
        RequestMethod.GET,
        FollowUserPageResponseDto,
      ],
      [
        'following',
        ':username/following',
        RequestMethod.GET,
        FollowUserPageResponseDto,
      ],
    ] as const)(
      '%s is %s %s with its response DTO',
      (name, path, method, dto) => {
        const handler = handlerOf(name);
        expect(reflector.get(PATH_KEY, handler)).toBe(path);
        expect(reflector.get(METHOD_KEY, handler)).toBe(method);
        expect(
          reflector.get<{ type?: unknown }>(SERIALIZE_OPTIONS_KEY, handler),
        ).toEqual({ type: dto });
      },
    );

    it.each(['follow', 'unfollow'] as const)(
      '%s answers 200 and is throttled by the user throttler',
      (name) => {
        const handler = handlerOf(name);
        expect(reflector.get(HTTP_CODE_KEY, handler)).toBe(HttpStatus.OK);
        expect(reflector.get(GUARDS_KEY, handler)).toEqual([ThrottlerGuard]);
        expect(Reflect.getMetadata('THROTTLER:LIMITuser', handler)).toBe(30);
        expect(Reflect.getMetadata('THROTTLER:TTLuser', handler)).toBe(60_000);
      },
    );

    it.each([
      'suggestions',
      'follow',
      'unfollow',
      'followers',
      'following',
    ] as const)('%s is not @Public()', (name) => {
      expect(reflector.get(IS_PUBLIC_KEY, handlerOf(name))).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, FollowsController)).toBeUndefined();
    });
  });
});
