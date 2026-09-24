import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './authenticated-user.interface.js';

// Injects the user AuthGuard attached to the request. Undefined only on
// @Public() routes, where the guard does not resolve a session.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
