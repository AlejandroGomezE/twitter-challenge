import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { NotificationPageResponseDto } from '../notification-page-response.dto.js';

class TestController {
  @SerializeOptions({ type: NotificationPageResponseDto })
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

const CREATED_AT = new Date('2026-09-24T10:00:00.000Z');

describe('NotificationPageResponseDto through ResponseSerializerInterceptor', () => {
  it('emits only the view fields, stripping extras on items and nested objects', async () => {
    const json = await serialize({
      items: [
        {
          id: 'n-2',
          recipientId: 'user-1',
          actorId: 'user-2',
          type: 'comment',
          createdAt: CREATED_AT,
          readAt: null,
          read: false,
          actor: {
            id: 'user-2',
            username: 'ada',
            displayName: null,
            email: 'ada@example.test',
            passwordHash: '$argon2id$secret',
          },
          post: { id: 'post-1', body: 'my post', authorId: 'user-1' },
          comment: { id: 'comment-1', body: 'nice', authorId: 'user-2' },
        },
        {
          id: 'n-1',
          type: 'follow',
          createdAt: CREATED_AT,
          read: true,
          actor: { username: 'bob', displayName: 'Bob' },
          post: null,
          comment: null,
        },
      ],
      nextCursor: 'abc_123',
      total: 2,
    });

    expect(json).toEqual({
      items: [
        {
          id: 'n-2',
          type: 'comment',
          createdAt: '2026-09-24T10:00:00.000Z',
          read: false,
          actor: { username: 'ada', displayName: null },
          post: { id: 'post-1', body: 'my post' },
          comment: { id: 'comment-1', body: 'nice' },
        },
        {
          id: 'n-1',
          type: 'follow',
          createdAt: '2026-09-24T10:00:00.000Z',
          read: true,
          actor: { username: 'bob', displayName: 'Bob' },
          post: null,
          comment: null,
        },
      ],
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
