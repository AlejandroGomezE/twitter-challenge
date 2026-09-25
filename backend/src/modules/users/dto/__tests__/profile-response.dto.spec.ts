import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { MyProfileResponseDto } from '../my-profile-response.dto.js';
import { ProfileResponseDto } from '../profile-response.dto.js';

class TestController {
  @SerializeOptions({ type: ProfileResponseDto })
  profile(): void {}

  @SerializeOptions({ type: MyProfileResponseDto })
  myProfile(): void {}
}

type HandlerName = 'profile' | 'myProfile';

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

const CREATED_AT = new Date('2026-01-02T03:04:05.678Z');
// A row carrying fields that must never leave the API next to the profile
// fields.
const ROW = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'someone',
  displayName: 'Some One',
  bio: 'hello',
  passwordHash: '$argon2id$secret',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  postCount: 12,
  followerCount: 5,
  followingCount: 7,
  isFollowing: true,
  followsYou: false,
  followerId: 'user-2',
  followingId: 'user-1',
};

describe('ProfileResponseDto', () => {
  it('emits only { username, displayName, bio, createdAt, postCount, followerCount, followingCount, isFollowing, followsYou } with createdAt as an ISO string', async () => {
    await expect(serialize('profile', ROW)).resolves.toEqual({
      username: 'someone',
      displayName: 'Some One',
      bio: 'hello',
      createdAt: '2026-01-02T03:04:05.678Z',
      postCount: 12,
      followerCount: 5,
      followingCount: 7,
      isFollowing: true,
      followsYou: false,
    });
  });

  it('keeps a null bio and display name as null and false booleans as false', async () => {
    await expect(
      serialize('profile', {
        ...ROW,
        displayName: null,
        bio: null,
        isFollowing: false,
        followsYou: false,
      }),
    ).resolves.toEqual({
      username: 'someone',
      displayName: null,
      bio: null,
      createdAt: '2026-01-02T03:04:05.678Z',
      postCount: 12,
      followerCount: 5,
      followingCount: 7,
      isFollowing: false,
      followsYou: false,
    });
  });
});

describe('MyProfileResponseDto', () => {
  it('emits only { id, email, username, displayName, bio, createdAt, postCount, followerCount, followingCount } with createdAt as an ISO string', async () => {
    await expect(serialize('myProfile', ROW)).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.test',
      username: 'someone',
      displayName: 'Some One',
      bio: 'hello',
      createdAt: '2026-01-02T03:04:05.678Z',
      postCount: 12,
      followerCount: 5,
      followingCount: 7,
    });
  });

  it('keeps a null display name as null', async () => {
    await expect(
      serialize('myProfile', { ...ROW, displayName: null }),
    ).resolves.toMatchObject({ displayName: null });
  });
});
