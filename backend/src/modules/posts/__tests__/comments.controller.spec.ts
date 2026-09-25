import { HttpStatus, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { USER_THROTTLER } from '../../../auth/throttlers.js';
import { CommentsController } from '../comments.controller.js';
import { CommentsService } from '../comments.service.js';
import { CommentPageResponseDto } from '../dto/comment-page-response.dto.js';
import { CommentResponseDto } from '../dto/comment-response.dto.js';

// Metadata keys set by @SerializeOptions(), @UseGuards(), @HttpCode(), the
// route decorators and @Throttle(). Nest does not export most of them from
// its entry points, so they are mirrored here.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';
const GUARDS_KEY = '__guards__';
const HTTP_CODE_KEY = '__httpCode__';
const PATH_KEY = 'path';
const METHOD_KEY = 'method';
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMIT';
const THROTTLER_TTL_KEY = 'THROTTLER:TTL';

const CALLER = { id: 'user-1', email: 'user@example.test', username: 'me_1' };

type Handler = 'list' | 'create' | 'delete';

function handlerOf(name: Handler): (...args: unknown[]) => unknown {
  return (
    CommentsController.prototype as unknown as Record<
      Handler,
      (...args: unknown[]) => unknown
    >
  )[name];
}

function throttleKeysOf(name: Handler): unknown[] {
  return Reflect.getMetadataKeys(handlerOf(name)).filter(
    (key) => typeof key === 'string' && key.startsWith('THROTTLER'),
  );
}

describe('CommentsController', () => {
  let controller: CommentsController;

  const commentsService = {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [{ provide: CommentsService, useValue: commentsService }],
    })
      // `create` is throttled; its guard's options are irrelevant here.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(CommentsController);
  });

  it('list passes the post id and the paging query', async () => {
    const page = { items: [], nextCursor: null };
    commentsService.list.mockResolvedValue(page);

    await expect(
      controller.list('post-1', { cursor: 'abc', limit: 5 }),
    ).resolves.toBe(page);
    expect(commentsService.list).toHaveBeenCalledWith('post-1', {
      cursor: 'abc',
      limit: 5,
    });
  });

  it('create comments as the session user on the path post', async () => {
    const comment = { id: 'comment-1' };
    commentsService.create.mockResolvedValue(comment);

    await expect(
      controller.create(CALLER, 'post-1', { body: 'nice' }),
    ).resolves.toBe(comment);
    expect(commentsService.create).toHaveBeenCalledWith(
      'post-1',
      CALLER.id,
      'nice',
    );
  });

  it('delete deletes as the session user', async () => {
    commentsService.delete.mockResolvedValue(undefined);

    await expect(
      controller.delete(CALLER, 'post-1', 'comment-1'),
    ).resolves.toBeUndefined();
    expect(commentsService.delete).toHaveBeenCalledWith(
      'post-1',
      'comment-1',
      CALLER.id,
    );
  });

  describe('declared metadata', () => {
    const reflector = new Reflector();

    it('is mounted at posts/:postId/comments and not @Public()', () => {
      expect(reflector.get(PATH_KEY, CommentsController)).toBe(
        'posts/:postId/comments',
      );
      expect(reflector.get(IS_PUBLIC_KEY, CommentsController)).toBeUndefined();
      expect(reflector.get(GUARDS_KEY, CommentsController)).toBeUndefined();
    });

    it.each([
      ['list', RequestMethod.GET, '/'],
      ['create', RequestMethod.POST, '/'],
      ['delete', RequestMethod.DELETE, ':commentId'],
    ] as const)('%s is routed as %s %s', (name, method, path) => {
      expect(reflector.get(METHOD_KEY, handlerOf(name))).toBe(method);
      expect(reflector.get(PATH_KEY, handlerOf(name))).toBe(path);
      expect(reflector.get(IS_PUBLIC_KEY, handlerOf(name))).toBeUndefined();
    });

    it.each([
      ['list', CommentPageResponseDto],
      ['create', CommentResponseDto],
    ] as const)('%s serializes through its response DTO', (name, type) => {
      expect(
        reflector.get<{ type?: unknown }>(
          SERIALIZE_OPTIONS_KEY,
          handlerOf(name),
        ),
      ).toEqual({ type });
    });

    it('delete answers 204 with no body type', () => {
      expect(reflector.get(HTTP_CODE_KEY, handlerOf('delete'))).toBe(
        HttpStatus.NO_CONTENT,
      );
      expect(
        reflector.get(SERIALIZE_OPTIONS_KEY, handlerOf('delete')),
      ).toBeUndefined();
    });

    it('create is throttled at 20 per minute per user', () => {
      const handler = handlerOf('create');
      expect(reflector.get(GUARDS_KEY, handler)).toEqual([ThrottlerGuard]);
      expect(
        Reflect.getMetadata(THROTTLER_LIMIT_KEY + USER_THROTTLER, handler),
      ).toBe(20);
      expect(
        Reflect.getMetadata(THROTTLER_TTL_KEY + USER_THROTTLER, handler),
      ).toBe(60_000);
    });

    it.each(['list', 'delete'] as const)(
      '%s is not rate-limited (no ThrottlerGuard, no @Throttle)',
      (name) => {
        expect(reflector.get(GUARDS_KEY, handlerOf(name))).toBeUndefined();
        expect(throttleKeysOf(name)).toEqual([]);
      },
    );
  });
});
