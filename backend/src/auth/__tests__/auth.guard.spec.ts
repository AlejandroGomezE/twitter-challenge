import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '../auth.guard.js';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../authenticated-user.interface.js';
import { Public } from '../public.decorator.js';

const FRONTEND_ORIGIN = 'http://localhost:5173';
const USER = { id: 'user-1', email: 'user@example.test' };

class PrivateController {
  handler(): void {}
}

@Public()
class PublicController {
  handler(): void {}
}

class MixedController {
  @Public()
  publicHandler(): void {}
}

interface FakeRequestInit {
  method?: string;
  origin?: string;
  sid?: string;
}

function makeRequest(init: FakeRequestInit = {}): AuthenticatedRequest {
  return {
    method: init.method ?? 'GET',
    headers: init.origin ? { origin: init.origin } : {},
    cookies: init.sid ? { sid: init.sid } : {},
  } as unknown as AuthenticatedRequest;
}

function makeContext(
  request: AuthenticatedRequest,
  controller: new () => object = PrivateController,
  handlerName = 'handler',
): ExecutionContext {
  const handler = (controller.prototype as Record<string, () => void>)[
    handlerName
  ];
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let guard: AuthGuard;
  const validateSession = vi.fn();

  beforeEach(async () => {
    validateSession.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthGuard,
        Reflector,
        { provide: AuthService, useValue: { validateSession } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => FRONTEND_ORIGIN },
        },
      ],
    }).compile();
    guard = moduleRef.get(AuthGuard);
  });

  describe('origin check', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'rejects %s from a foreign origin, even on a public route',
      async (method) => {
        const request = makeRequest({ method, origin: 'http://evil.test' });
        await expect(
          guard.canActivate(makeContext(request, PublicController)),
        ).rejects.toThrow(ForbiddenException);
      },
    );

    it('rejects a foreign origin before any session lookup', async () => {
      const request = makeRequest({
        method: 'POST',
        origin: 'http://evil.test',
        sid: 'good',
      });
      await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
        ForbiddenException,
      );
      expect(validateSession).not.toHaveBeenCalled();
    });

    it('allows a POST from the frontend origin', async () => {
      const request = makeRequest({ method: 'POST', origin: FRONTEND_ORIGIN });
      await expect(
        guard.canActivate(makeContext(request, PublicController)),
      ).resolves.toBe(true);
    });

    it('allows a POST without an Origin header', async () => {
      const request = makeRequest({ method: 'POST' });
      await expect(
        guard.canActivate(makeContext(request, PublicController)),
      ).resolves.toBe(true);
    });

    it('ignores Origin on safe methods', async () => {
      const request = makeRequest({
        method: 'GET',
        origin: 'http://evil.test',
      });
      await expect(
        guard.canActivate(makeContext(request, PublicController)),
      ).resolves.toBe(true);
    });
  });

  describe('session check', () => {
    it('allows a @Public() class without looking up a session', async () => {
      await expect(
        guard.canActivate(makeContext(makeRequest(), PublicController)),
      ).resolves.toBe(true);
      expect(validateSession).not.toHaveBeenCalled();
    });

    it('allows a @Public() handler without looking up a session', async () => {
      await expect(
        guard.canActivate(
          makeContext(makeRequest(), MixedController, 'publicHandler'),
        ),
      ).resolves.toBe(true);
      expect(validateSession).not.toHaveBeenCalled();
    });

    it('rejects a protected route when the session is invalid', async () => {
      validateSession.mockResolvedValue(null);
      await expect(
        guard.canActivate(makeContext(makeRequest({ sid: 'bad' }))),
      ).rejects.toThrow(UnauthorizedException);
      expect(validateSession).toHaveBeenCalledWith('bad');
    });

    it('rejects a protected route without a cookie', async () => {
      validateSession.mockResolvedValue(null);
      await expect(
        guard.canActivate(makeContext(makeRequest())),
      ).rejects.toThrow(UnauthorizedException);
      expect(validateSession).toHaveBeenCalledWith(undefined);
    });

    it('attaches the user for a valid session', async () => {
      validateSession.mockResolvedValue(USER);
      const request = makeRequest({ sid: 'good' });
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toEqual(USER);
    });
  });
});
