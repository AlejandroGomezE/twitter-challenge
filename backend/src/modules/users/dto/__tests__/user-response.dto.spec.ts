import {
  type CallHandler,
  type ExecutionContext,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../../../../common/interceptors/response-serializer.interceptor.js';
import { UserResponseDto } from '../user-response.dto.js';

class TestController {
  @SerializeOptions({ type: UserResponseDto })
  user(): void {}
}

// Runs a body through the global fail-closed serializer
// (excludeExtraneousValues) and then JSON, like the HTTP response.
async function serialize(body: unknown): Promise<unknown> {
  const context = {
    getHandler: () => TestController.prototype.user,
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

const ROW = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'someone',
  displayName: 'Some One',
  bio: 'hello',
  passwordHash: '$argon2id$secret',
  createdAt: new Date(),
};

describe('UserResponseDto', () => {
  it('drops every field that is not @Expose()d', () => {
    // Same transform path ClassSerializerInterceptor uses when a handler
    // declares @SerializeOptions({ type: UserResponseDto }).
    const options = { excludeExtraneousValues: true };

    const plain = instanceToPlain(
      plainToInstance(UserResponseDto, ROW, options),
      options,
    );

    expect(plain).toEqual({
      id: 'user-1',
      email: 'user@example.test',
      username: 'someone',
      displayName: 'Some One',
    });
    expect(Object.keys(plain).sort()).toEqual([
      'displayName',
      'email',
      'id',
      'username',
    ]);
  });

  it('emits only { id, email, username, displayName } through the global serializer', async () => {
    await expect(serialize(ROW)).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.test',
      username: 'someone',
      displayName: 'Some One',
    });
  });

  it('keeps a null display name as null', async () => {
    await expect(serialize({ ...ROW, displayName: null })).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.test',
      username: 'someone',
      displayName: null,
    });
  });
});
