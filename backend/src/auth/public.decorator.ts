import { type CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Opts a handler (or a whole controller) out of the global AuthGuard's
// session requirement. The guard's Origin (CSRF) check still applies.
export const Public = (): CustomDecorator<string> =>
  SetMetadata(IS_PUBLIC_KEY, true);
