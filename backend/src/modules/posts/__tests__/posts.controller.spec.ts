import { HttpStatus, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { LikeStateResponseDto } from '../dto/like-state-response.dto.js';
import { PostsController } from '../posts.controller.js';
import { PostsService } from '../posts.service.js';

// Metadata keys set by @SerializeOptions(), @UseGuards(), @HttpCode() and the
// route decorators. Nest does not export them from the @nestjs/common entry
// point, so they are mirrored here.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';
const GUARDS_KEY = '__guards__';
const HTTP_CODE_KEY = '__httpCode__';
const PATH_KEY = 'path';
const METHOD_KEY = 'method';

const CALLER = { id: 'user-1', email: 'user@example.test', username: 'me_1' };

type LikeHandler = 'like' | 'unlike';

function handlerOf(name: LikeHandler): (...args: unknown[]) => unknown {
  return (
    PostsController.prototype as unknown as Record<
      LikeHandler,
      (...args: unknown[]) => unknown
    >
  )[name];
}

describe('PostsController (likes)', () => {
  let controller: PostsController;

  const postsService = { setLiked: vi.fn() };

  beforeEach(async () => {
    postsService.setLiked.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [{ provide: PostsService, useValue: postsService }],
    })
      // `create` is throttled; its guard's options are irrelevant here.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(PostsController);
  });

  it('like sets liked=true for the session user and returns the state', async () => {
    const state = { liked: true, likeCount: 1 };
    postsService.setLiked.mockResolvedValue(state);

    await expect(controller.like(CALLER, 'post-1')).resolves.toBe(state);
    expect(postsService.setLiked).toHaveBeenCalledWith(
      'post-1',
      CALLER.id,
      true,
    );
  });

  it('unlike sets liked=false for the session user and returns the state', async () => {
    const state = { liked: false, likeCount: 0 };
    postsService.setLiked.mockResolvedValue(state);

    await expect(controller.unlike(CALLER, 'post-1')).resolves.toBe(state);
    expect(postsService.setLiked).toHaveBeenCalledWith(
      'post-1',
      CALLER.id,
      false,
    );
  });

  describe('declared metadata', () => {
    const reflector = new Reflector();

    it.each([
      ['like', RequestMethod.PUT],
      ['unlike', RequestMethod.DELETE],
    ] as const)('%s is routed at :id/like', (name, method) => {
      expect(reflector.get(PATH_KEY, handlerOf(name))).toBe(':id/like');
      expect(reflector.get(METHOD_KEY, handlerOf(name))).toBe(method);
    });

    it.each(['like', 'unlike'] as const)('%s answers 200', (name) => {
      expect(reflector.get(HTTP_CODE_KEY, handlerOf(name))).toBe(HttpStatus.OK);
    });

    it.each(['like', 'unlike'] as const)(
      '%s serializes through LikeStateResponseDto',
      (name) => {
        expect(
          reflector.get<{ type?: unknown }>(
            SERIALIZE_OPTIONS_KEY,
            handlerOf(name),
          ),
        ).toEqual({ type: LikeStateResponseDto });
      },
    );

    it.each(['like', 'unlike'] as const)('%s is not @Public()', (name) => {
      expect(reflector.get(IS_PUBLIC_KEY, handlerOf(name))).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, PostsController)).toBeUndefined();
    });

    it.each(['like', 'unlike'] as const)(
      '%s is not rate-limited (no ThrottlerGuard, no @Throttle)',
      (name) => {
        const handler = handlerOf(name);
        expect(reflector.get(GUARDS_KEY, handler)).toBeUndefined();
        expect(reflector.get(GUARDS_KEY, PostsController)).toBeUndefined();
        const throttleKeys = Reflect.getMetadataKeys(handler).filter(
          (key) => typeof key === 'string' && key.startsWith('THROTTLER'),
        );
        expect(throttleKeys).toEqual([]);
      },
    );
  });
});
