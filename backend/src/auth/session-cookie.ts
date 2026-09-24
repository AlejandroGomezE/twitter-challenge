import type { CookieOptions, Request, Response } from 'express';
import { SESSION_COOKIE } from './session.constants.js';

// `secure` should be true in production (nodeEnv === 'production'); the
// caller reads it from ConfigService so these helpers stay pure.
function baseCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  res.cookie(SESSION_COOKIE, token, {
    ...baseCookieOptions(secure),
    expires: expiresAt,
  });
}

// Options must match those used when setting the cookie, otherwise the
// browser will not clear it.
export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, baseCookieOptions(secure));
}

export function readSessionToken(req: Request): string | undefined {
  const cookies: Record<string, unknown> | undefined = req.cookies as
    Record<string, unknown> | undefined;
  const token = cookies?.[SESSION_COOKIE];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}
