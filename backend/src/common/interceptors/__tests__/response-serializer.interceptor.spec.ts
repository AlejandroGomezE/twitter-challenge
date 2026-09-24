import {
  type CallHandler,
  type ExecutionContext,
  InternalServerErrorException,
  SerializeOptions,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Expose } from 'class-transformer';
import { lastValueFrom, of } from 'rxjs';
import { ResponseSerializerInterceptor } from '../response-serializer.interceptor.js';

class ItemResponseDto {
  @Expose()
  id: string;
}

class TestController {
  @SerializeOptions({ type: ItemResponseDto })
  typed(): void {}

  untyped(): void {}
}

function makeContext(handlerName: 'typed' | 'untyped'): ExecutionContext {
  return {
    getHandler: () => TestController.prototype[handlerName],
    getClass: () => TestController,
  } as unknown as ExecutionContext;
}

function handlerReturning(body: unknown): CallHandler {
  return { handle: () => of(body) };
}

describe('ResponseSerializerInterceptor', () => {
  let interceptor: ResponseSerializerInterceptor;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ResponseSerializerInterceptor, Reflector],
    }).compile();
    interceptor = moduleRef.get(ResponseSerializerInterceptor);
  });

  async function run(
    handlerName: 'typed' | 'untyped',
    body: unknown,
  ): Promise<unknown> {
    const result$ = await interceptor.intercept(
      makeContext(handlerName),
      handlerReturning(body),
    );
    return lastValueFrom(result$, { defaultValue: undefined });
  }

  it('emits only the exposed fields of the declared response DTO', async () => {
    const body = await run('typed', {
      id: 'item-1',
      passwordHash: '$argon2id$secret',
    });
    expect(body).toEqual({ id: 'item-1' });
  });

  it('throws a 500 when a body is returned without a declared type', async () => {
    const promise = run('untyped', { id: 'item-1', passwordHash: 'secret' });
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.not.toThrow(/secret/);
  });

  it('lets an undefined (204) body through', async () => {
    expect(await run('untyped', undefined)).toBeUndefined();
  });
});
