import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './authenticated-user.interface.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { readSessionToken } from './session-cookie.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Global guard (registered via APP_GUARD in AuthModule): every route requires
// a valid session unless marked @Public().
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    this.assertTrustedOrigin(request);

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const user = await this.authService.validateSession(
      readSessionToken(request),
    );
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    request.user = user;
    return true;
  }

  // CSRF defence, applied to public routes too (login CSRF matters). Browsers
  // always send Origin on cross-origin state-changing requests, so a foreign
  // Origin is rejected. A missing Origin is allowed: it comes from
  // non-browser clients, which carry no ambient cookies to abuse.
  private assertTrustedOrigin(request: AuthenticatedRequest): void {
    if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
      return;
    }
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      origin !== this.configService.getOrThrow<string>('frontendOrigin')
    ) {
      throw new ForbiddenException('Invalid origin');
    }
  }
}
