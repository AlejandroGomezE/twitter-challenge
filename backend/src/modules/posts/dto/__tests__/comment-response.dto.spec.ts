import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { CommentPageResponseDto } from '../comment-page-response.dto.js';
import { CommentResponseDto } from '../comment-response.dto.js';

class TestController {
  @SerializeOptions({ type: CommentResponseDto })
  comment(): void {}

  @SerializeOptions({ type: CommentPageResponseDto })
  page(): void {}
}

// Runs a body through the global fail-closed serializer
// (excludeExtraneousValues) and then JSON, like the HTTP response.
async function serialize(
  handlerName: 'comment' | 'page',
  body: unknown,
): Promise<unknown> {
  const context = {
    getHandler: () => TestController.prototype[handlerName],
    getClass: () => TestController,
  } as unknown as ExecutionContext;
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

// A comment carrying fields that must never leave the API, on the item and
// on its nested author.
function leakyComment(id: string): Record<string, unknown> {
  return {
    id,
    postId: 'post-1',
    authorId: 'user-1',
    body: `body of ${id} 😀`,
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    author: {
      id: 'user-1',
      username: 'someone',
      email: 'someone@example.test',
      passwordHash: '$argon2id$secret',
    },
    internal: 'x',
  };
}

function expectedComment(id: string): Record<string, unknown> {
  return {
    id,
    body: `body of ${id} 😀`,
    createdAt: '2026-09-24T10:00:00.000Z',
    author: { username: 'someone' },
  };
}

describe('Comment response DTOs through ResponseSerializerInterceptor', () => {
  it('CommentResponseDto emits the nested author and an ISO createdAt, dropping everything else', async () => {
    await expect(
      serialize('comment', leakyComment('comment-1')),
    ).resolves.toEqual(expectedComment('comment-1'));
  });

  it('CommentPageResponseDto strips extra fields on the page, items and nested authors', async () => {
    const json = await serialize('page', {
      items: [leakyComment('comment-1'), leakyComment('comment-2')],
      nextCursor: 'abc_123',
      total: 99,
    });

    expect(json).toEqual({
      items: [expectedComment('comment-1'), expectedComment('comment-2')],
      nextCursor: 'abc_123',
    });
  });

  it('CommentPageResponseDto keeps a null nextCursor and an empty items array', async () => {
    await expect(
      serialize('page', { items: [], nextCursor: null }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });
});
