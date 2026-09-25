import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { LikeStateResponseDto } from '../like-state-response.dto.js';

class TestController {
  @SerializeOptions({ type: LikeStateResponseDto })
  likeState(): void {}
}

const context = {
  getHandler: () => TestController.prototype.likeState,
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

describe('LikeStateResponseDto through ResponseSerializerInterceptor', () => {
  it('emits only { liked, likeCount }', async () => {
    await expect(
      serialize({
        liked: true,
        likeCount: 3,
        userId: 'user-1',
        postId: 'post-1',
      }),
    ).resolves.toEqual({ liked: true, likeCount: 3 });
  });

  it('keeps liked=false and a zero count', async () => {
    await expect(serialize({ liked: false, likeCount: 0 })).resolves.toEqual({
      liked: false,
      likeCount: 0,
    });
  });
});
