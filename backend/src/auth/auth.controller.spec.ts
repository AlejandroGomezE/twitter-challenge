import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { UserResponseDto } from '../modules/users/dto/user-response.dto.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

// Metadata keys set by @SerializeOptions() and @UseGuards(). Nest does not
// export them from the @nestjs/common entry point, so they are mirrored here
// (CLASS_SERIALIZER_OPTIONS and GUARDS_METADATA in @nestjs/common).
const SERIALIZE_OPTIONS_KEY = 'class_serializer:options';
const GUARDS_KEY = '__guards__';

const USER = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'someone',
};
const TOKEN = 'session-token';
const EXPIRES_AT = new Date('2026-06-08T12:00:00.000Z');
const CREDENTIALS = { email: 'user@example.test', password: 'password123' };
const SIGN_UP = { ...CREDENTIALS, username: 'someone' };

function makeResponse(): Response & {
  cookie: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
} {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

function makeRequest(cookies?: Record<string, string>): Request {
  return { cookies } as unknown as Request;
}

type Handler = 'signUp' | 'signIn' | 'signOut' | 'me';

function handlerOf(name: Handler): (...args: unknown[]) => unknown {
  return (
    AuthController.prototype as unknown as Record<
      Handler,
      (...args: unknown[]) => unknown
    >
  )[name];
}

describe('AuthController', () => {
  let controller: AuthController;
  let nodeEnv: string;

  const authService = {
    signUp: vi.fn(),
    signIn: vi.fn(),
    revokeSession: vi.fn(),
  };

  beforeEach(async () => {
    nodeEnv = 'development';
    authService.signUp.mockReset();
    authService.signIn.mockReset();
    authService.revokeSession.mockReset();
    authService.signUp.mockResolvedValue({
      user: USER,
      session: { token: TOKEN, expiresAt: EXPIRES_AT },
    });
    authService.signIn.mockResolvedValue({
      user: USER,
      session: { token: TOKEN, expiresAt: EXPIRES_AT },
    });
    authService.revokeSession.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'nodeEnv' ? nodeEnv : undefined),
          },
        },
      ],
    })
      // The guard's own dependencies (throttler options/storage) are not
      // under test here; its application is asserted via metadata below.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AuthController);
  });

  describe.each([
    ['signUp', authService.signUp],
    ['signIn', authService.signIn],
  ] as const)('%s', (name, serviceMethod) => {
    const call = (res: Response) =>
      name === 'signUp'
        ? controller.signUp(SIGN_UP, res)
        : controller.signIn(CREDENTIALS, res);

    it('calls the service with the credentials and returns the user', async () => {
      const res = makeResponse();

      await expect(call(res)).resolves.toEqual(USER);
      // Sign-up also passes the username, between email and password.
      const expectedArgs =
        name === 'signUp'
          ? [SIGN_UP.email, SIGN_UP.username, SIGN_UP.password]
          : [CREDENTIALS.email, CREDENTIALS.password];
      expect(serviceMethod).toHaveBeenCalledWith(...expectedArgs);
    });

    it('sets a non-secure httpOnly session cookie in development', async () => {
      const res = makeResponse();

      await call(res);

      expect(res.cookie).toHaveBeenCalledTimes(1);
      expect(res.cookie).toHaveBeenCalledWith('sid', TOKEN, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        expires: EXPIRES_AT,
      });
    });

    it('sets a secure cookie in production', async () => {
      nodeEnv = 'production';
      const res = makeResponse();

      await call(res);

      expect(res.cookie).toHaveBeenCalledWith('sid', TOKEN, {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        expires: EXPIRES_AT,
      });
    });

    it('sets no cookie when the service fails', async () => {
      serviceMethod.mockRejectedValue(new Error('boom'));
      const res = makeResponse();

      await expect(call(res)).rejects.toThrow('boom');
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('signOut', () => {
    it('revokes the cookie session and clears the cookie with matching options', async () => {
      const res = makeResponse();

      await expect(
        controller.signOut(makeRequest({ sid: TOKEN }), res),
      ).resolves.toBeUndefined();

      expect(authService.revokeSession).toHaveBeenCalledWith(TOKEN);
      expect(res.clearCookie).toHaveBeenCalledWith('sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
      });
    });

    it('clears a secure cookie in production', async () => {
      nodeEnv = 'production';
      const res = makeResponse();

      await controller.signOut(makeRequest({ sid: TOKEN }), res);

      expect(res.clearCookie).toHaveBeenCalledWith('sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
      });
    });

    it.each([
      ['no cookies object', undefined],
      ['no sid cookie', {}],
    ])('works with %s', async (_label, cookies) => {
      const res = makeResponse();

      await controller.signOut(makeRequest(cookies), res);

      expect(authService.revokeSession).toHaveBeenCalledWith(undefined);
      expect(res.clearCookie).toHaveBeenCalledTimes(1);
    });
  });

  describe('me', () => {
    it('returns the current user', () => {
      expect(controller.me(USER)).toBe(USER);
    });
  });

  describe('declared metadata', () => {
    const reflector = new Reflector();

    it.each(['signUp', 'signIn', 'me'] as const)(
      '%s serializes through UserResponseDto',
      (name) => {
        expect(
          reflector.get<{ type?: unknown }>(
            SERIALIZE_OPTIONS_KEY,
            handlerOf(name),
          ),
        ).toEqual({ type: UserResponseDto });
      },
    );

    it('signOut declares no response type (204, no body)', () => {
      expect(
        reflector.get(SERIALIZE_OPTIONS_KEY, handlerOf('signOut')),
      ).toBeUndefined();
    });

    it.each(['signUp', 'signIn', 'signOut'] as const)(
      '%s is @Public()',
      (name) => {
        expect(reflector.get(IS_PUBLIC_KEY, handlerOf(name))).toBe(true);
      },
    );

    it('me is not @Public() (at handler or controller level)', () => {
      expect(reflector.get(IS_PUBLIC_KEY, handlerOf('me'))).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, AuthController)).toBeUndefined();
    });

    it.each(['signUp', 'signIn'] as const)(
      '%s is rate-limited by ThrottlerGuard',
      (name) => {
        expect(reflector.get(GUARDS_KEY, handlerOf(name))).toEqual([
          ThrottlerGuard,
        ]);
      },
    );

    it.each(['signOut', 'me'] as const)('%s is not rate-limited', (name) => {
      expect(reflector.get(GUARDS_KEY, handlerOf(name))).toBeUndefined();
    });

    it('applies no guards at the controller level', () => {
      expect(reflector.get(GUARDS_KEY, AuthController)).toBeUndefined();
    });
  });
});
