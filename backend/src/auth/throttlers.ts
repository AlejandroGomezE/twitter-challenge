import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type {
  ThrottlerGetTrackerFunction,
  ThrottlerOptions,
} from '@nestjs/throttler';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './authenticated-user.interface.js';

// Named throttlers shared by every route that opts in with
// @UseGuards(ThrottlerGuard). ThrottlerGuard evaluates ALL configured
// throttlers on each guarded route, so each one selects itself by whether the
// request carries a session user (set by the global AuthGuard, which runs
// before route-level guards):
// - 'auth': anonymous (@Public()) routes such as sign-up/sign-in, keyed by
//   client IP (the guard's default tracker), 5 requests per 60s per route.
// - 'user': signed-in routes, keyed by the session user's id — so users behind
//   one IP don't share a budget and one user can't dodge it by switching IPs.
//   Each route sets its own limit with @Throttle({ [USER_THROTTLER]: … }).
// Counters are per route either way (the storage key includes the controller
// and handler names).
const AUTH_THROTTLER = 'auth';
export const USER_THROTTLER = 'user';

export const THROTTLE_TTL_MS = 60_000;
const AUTH_THROTTLE_LIMIT = 5;
const USER_THROTTLE_DEFAULT_LIMIT = 10;

function sessionUser(context: ExecutionContext): AuthenticatedUser | undefined {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
}

// Only reached when a session user is present (see skipIf below); the throw
// keeps an anonymous request from ever sharing a single "undefined" bucket.
const trackSessionUser: ThrottlerGetTrackerFunction = (_req, context) => {
  const user = sessionUser(context);
  if (!user) {
    throw new UnauthorizedException('Authentication required');
  }
  return `user:${user.id}`;
};

export const THROTTLERS: ThrottlerOptions[] = [
  {
    name: AUTH_THROTTLER,
    ttl: THROTTLE_TTL_MS,
    limit: AUTH_THROTTLE_LIMIT,
    skipIf: (context) => sessionUser(context) !== undefined,
  },
  {
    name: USER_THROTTLER,
    ttl: THROTTLE_TTL_MS,
    limit: USER_THROTTLE_DEFAULT_LIMIT,
    skipIf: (context) => sessionUser(context) === undefined,
    getTracker: trackSessionUser,
  },
];
