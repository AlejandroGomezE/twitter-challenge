import { ApiError, type ApiErrorBody } from '@/lib/api/client'

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.'
const RATE_LIMIT_MESSAGE = 'Too many attempts. Try again in a minute.'

// Turns a rejected API call into text for a page's error Alert. Rate limiting (429) gets a fixed,
// friendlier message — `rateLimitMessage` overrides it where "attempts" doesn't fit (e.g. "Too many
// posts…"). Nest validation errors carry an array of messages in the body (`Error` stringifies it
// into `error.message` as "a,b"), so they are joined from the raw body.
export interface ApiErrorMessageOptions {
  rateLimitMessage?: string
}

export function getApiErrorMessage(
  error: unknown,
  { rateLimitMessage = RATE_LIMIT_MESSAGE }: ApiErrorMessageOptions = {},
) {
  if (!(error instanceof ApiError)) return FALLBACK_MESSAGE
  if (error.status === 429) return rateLimitMessage
  // The body is whatever the API sent (JSON, text or nothing); only an array `message` is used.
  const body = error.body as ApiErrorBody | null | undefined
  if (Array.isArray(body?.message)) return body.message.join('. ')
  return error.message || FALLBACK_MESSAGE
}
