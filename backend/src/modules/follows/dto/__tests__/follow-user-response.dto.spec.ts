import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { FollowStateResponseDto } from '../follow-state-response.dto.js';
import { FollowUserListResponseDto } from '../follow-user-list-response.dto.js';
import { FollowUserPageResponseDto } from '../follow-user-page-response.dto.js';
import { FollowUserResponseDto } from '../follow-user-response.dto.js';

class TestController {
  @SerializeOptions({ type: FollowUserResponseDto })
  user(): void {}

  @SerializeOptions({ type: FollowUserPageResponseDto })
  page(): void {}

  @SerializeOptions({ type: FollowUserListResponseDto })
  list(): void {}

  @SerializeOptions({ type: FollowStateResponseDto })
  state(): void {}
}

type HandlerName = 'user' | 'page' | 'list' | 'state';

// Runs a body through the global fail-closed serializer
// (excludeExtraneousValues) and then JSON, like the HTTP response.
async function serialize(
  handlerName: HandlerName,
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

// A user row carrying fields that must never leave the API.
function leakyUser(
  username: string,
  displayName: string | null = `Name ${username}`,
): Record<string, unknown> {
  return {
    id: `id-${username}`,
    email: `${username}@example.test`,
    passwordHash: '$argon2id$secret',
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    username,
    displayName,
    bio: null,
    isFollowing: true,
    followsYou: false,
  };
}

function expectedUser(
  username: string,
  displayName: string | null = `Name ${username}`,
): Record<string, unknown> {
  return {
    username,
    displayName,
    bio: null,
    isFollowing: true,
    followsYou: false,
  };
}

describe('Follow response DTOs through ResponseSerializerInterceptor', () => {
  it('FollowUserResponseDto keeps only username, displayName, bio and the two booleans', async () => {
    await expect(serialize('user', leakyUser('alice'))).resolves.toEqual(
      expectedUser('alice'),
    );
  });

  it('FollowUserResponseDto keeps a null displayName as null', async () => {
    await expect(serialize('user', leakyUser('alice', null))).resolves.toEqual(
      expectedUser('alice', null),
    );
  });

  it('FollowUserPageResponseDto strips extra fields on the page and every item', async () => {
    await expect(
      serialize('page', {
        items: [leakyUser('alice'), leakyUser('bob', null)],
        nextCursor: 'abc_123',
        total: 99,
      }),
    ).resolves.toEqual({
      items: [expectedUser('alice'), expectedUser('bob', null)],
      nextCursor: 'abc_123',
    });
  });

  it('FollowUserPageResponseDto keeps a null nextCursor and an empty page', async () => {
    await expect(
      serialize('page', { items: [], nextCursor: null }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('FollowUserListResponseDto strips extra fields on every item', async () => {
    await expect(
      serialize('list', { items: [leakyUser('carol')], nextCursor: 'x' }),
    ).resolves.toEqual({ items: [expectedUser('carol')] });
  });

  it('FollowStateResponseDto keeps only following and followerCount', async () => {
    await expect(
      serialize('state', {
        following: true,
        followerCount: 3,
        followerId: 'id-1',
        followingId: 'id-2',
      }),
    ).resolves.toEqual({ following: true, followerCount: 3 });
  });
});
