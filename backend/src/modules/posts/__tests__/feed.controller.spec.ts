import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../../auth/public.decorator.js';
import { PostPageResponseDto } from '../dto/post-page-response.dto.js';
import { FeedController } from '../feed.controller.js';
import { PostsService } from '../posts.service.js';

// Metadata key set by @SerializeOptions(). Nest does not export it from the
// @nestjs/common entry point (CLASS_SERIALIZER_OPTIONS), so it is mirrored.
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';

const CALLER = { id: 'user-1', email: 'user@example.test', username: 'me_1' };
const PAGE = { items: [], nextCursor: null };

describe('FeedController', () => {
  let controller: FeedController;

  const postsService = { feed: vi.fn(), forYou: vi.fn() };

  beforeEach(async () => {
    postsService.feed.mockReset();
    postsService.feed.mockResolvedValue(PAGE);
    postsService.forYou.mockReset();
    postsService.forYou.mockResolvedValue(PAGE);
    const moduleRef = await Test.createTestingModule({
      controllers: [FeedController],
      providers: [{ provide: PostsService, useValue: postsService }],
    }).compile();
    controller = moduleRef.get(FeedController);
  });

  it("returns the session user's feed page with the query's cursor and limit", async () => {
    await expect(
      controller.feed(CALLER, { cursor: 'abc', limit: 5 }),
    ).resolves.toBe(PAGE);
    expect(postsService.feed).toHaveBeenCalledWith(CALLER.id, {
      cursor: 'abc',
      limit: 5,
    });
  });

  it("returns the session user's for-you page with the query's cursor and limit", async () => {
    await expect(
      controller.forYou(CALLER, { cursor: 'abc', limit: 5 }),
    ).resolves.toBe(PAGE);
    expect(postsService.forYou).toHaveBeenCalledWith(CALLER.id, {
      cursor: 'abc',
      limit: 5,
    });
    expect(postsService.feed).not.toHaveBeenCalled();
  });

  it('serves the for-you feed at GET /feed/for-you', () => {
    const reflector = new Reflector();
    expect(reflector.get<string>('path', FeedController)).toBe('feed');
    expect(reflector.get<string>('path', FeedController.prototype.forYou)).toBe(
      'for-you',
    );
  });

  describe.each(['feed', 'forYou'] as const)(
    'declared metadata of %s',
    (name) => {
      const reflector = new Reflector();
      const handler = (
        FeedController.prototype as unknown as Record<
          typeof name,
          (...args: unknown[]) => unknown
        >
      )[name];

      it('serializes through PostPageResponseDto', () => {
        expect(
          reflector.get<{ type?: unknown }>(SERIALIZE_OPTIONS_KEY, handler),
        ).toEqual({ type: PostPageResponseDto });
      });

      it('is not @Public()', () => {
        expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
        expect(reflector.get(IS_PUBLIC_KEY, FeedController)).toBeUndefined();
      });
    },
  );
});
