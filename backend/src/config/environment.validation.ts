import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Must be an exact serialized origin (scheme://host[:port], no path or
  // trailing slash): AuthGuard and CORS compare it verbatim with the browser's
  // Origin header, so e.g. `http://localhost:5173/` would silently reject
  // every request. Rejected here instead of normalized because
  // configuration.ts reads the raw value from process.env.
  FRONTEND_ORIGIN: z
    .string()
    .url()
    // Zod 4 still runs refinements after .url() fails, so guard the parse
    // to keep a non-URL value on the formatted validation-error path.
    .refine((value) => URL.canParse(value) && new URL(value).origin === value, {
      message:
        'FRONTEND_ORIGIN must be an exact origin like http://localhost:5173 (no path or trailing slash)',
    })
    .default('http://localhost:5173'),
  OBSERVE_APP_KEY: z.string().optional(),
  OBSERVE_APP_SECRET: z.string().optional(),
});

export function validate(config: Record<string, unknown>) {
  const result = environmentSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${result.error.message}`);
  }
  return result.data;
}
