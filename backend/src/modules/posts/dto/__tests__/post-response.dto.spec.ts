import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { PostResponseDto } from '../post-response.dto.js';

class TestController {
  @SerializeOptions({ type: PostResponseDto })
  post(): void {}
}

const context = {
  getHandler: () => TestController.prototype.post,
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

describe('PostResponseDto through ResponseSerializerInterceptor', () => {
  it('emits the nested author and an ISO createdAt, dropping everything else', async () => {
    const json = await serialize({
      id: 'post-1',
      authorId: 'user-1',
      body: 'hello 😀',
      createdAt: new Date('2026-09-24T10:00:00.000Z'),
      author: {
        id: 'user-1',
        username: 'someone',
        displayName: 'Some One',
        email: 'someone@example.test',
        passwordHash: '$argon2id$secret',
      },
      likeCount: 3,
      commentCount: 1,
      likedByMe: true,
    });

    expect(json).toEqual({
      id: 'post-1',
      body: 'hello 😀',
      createdAt: '2026-09-24T10:00:00.000Z',
      author: { username: 'someone', displayName: 'Some One' },
      likeCount: 3,
      commentCount: 1,
      likedByMe: true,
    });
  });

  it('keeps a null author display name as null', async () => {
    const json = await serialize({
      id: 'post-1',
      body: 'hello',
      createdAt: new Date('2026-09-24T10:00:00.000Z'),
      author: { id: 'user-1', username: 'someone', displayName: null },
      likeCount: 0,
      commentCount: 0,
      likedByMe: false,
    });

    expect(json).toMatchObject({
      author: { username: 'someone', displayName: null },
    });
    expect((json as { author: object }).author).not.toHaveProperty('id');
  });
});
