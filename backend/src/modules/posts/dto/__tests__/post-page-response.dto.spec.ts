import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { PostPageResponseDto } from '../post-page-response.dto.js';

class TestController {
  @SerializeOptions({ type: PostPageResponseDto })
  page(): void {}
}

const context = {
  getHandler: () => TestController.prototype.page,
  getClass: () => TestController,
} as unknown as ExecutionContext;

// Runs a body through the global fail-closed serializer
// (excludeExtraneousValues) and then JSON, like the HTTP response.
async function serialize(body: unknown): Promise<unknown> {
  const moduleRef = await Test.createTestingModule({
    providers: [ResponseSerializerInterceptor, Reflector],
  }).compile();
  const interceptor = moduleRef.get(ResponseSerializerInterceptor);
  const handler: CallHandler = { handle: () => of(body) };
  const result = await lastValueFrom(
    await interceptor.intercept(context, handler),
  );
  return JSON.parse(JSON.stringify(result)) as unknown;
}

// A post carrying fields that must never leave the API, on the item and on
// its nested author.
function leakyPost(id: string): Record<string, unknown> {
  return {
    id,
    authorId: 'user-1',
    body: `body of ${id}`,
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    author: {
      id: 'user-1',
      username: 'someone',
      email: 'someone@example.test',
      passwordHash: '$argon2id$secret',
    },
    likeCount: 2,
    commentCount: 0,
    likedByMe: false,
    internal: 'x',
  };
}

function expectedItem(id: string): Record<string, unknown> {
  return {
    id,
    body: `body of ${id}`,
    createdAt: '2026-09-24T10:00:00.000Z',
    author: { username: 'someone' },
    likeCount: 2,
    commentCount: 0,
    likedByMe: false,
  };
}

describe('PostPageResponseDto through ResponseSerializerInterceptor', () => {
  it('emits { items, nextCursor } and strips extra fields on items and nested authors', async () => {
    const json = await serialize({
      items: [leakyPost('post-2'), leakyPost('post-1')],
      nextCursor: 'abc_123',
      total: 99,
    });

    expect(json).toEqual({
      items: [expectedItem('post-2'), expectedItem('post-1')],
      nextCursor: 'abc_123',
    });
  });

  it('keeps a null nextCursor and an empty items array', async () => {
    await expect(serialize({ items: [], nextCursor: null })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
