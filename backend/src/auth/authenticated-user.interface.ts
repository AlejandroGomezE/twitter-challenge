import type { Request } from 'express';
import type { PublicUser } from '../modules/users/users.service.js';

// The user resolved from a valid session cookie by the global AuthGuard.
export type AuthenticatedUser = PublicUser;

// Express request as seen after AuthGuard: `user` is set on every
// non-@Public() route that reached the handler.
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
