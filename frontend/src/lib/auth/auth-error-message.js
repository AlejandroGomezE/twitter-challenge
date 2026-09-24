import { ApiError } from '@/lib/api/client'

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.'

// Turns a rejected signIn/signUp into text for the page's error Alert. Rate limiting (429) gets a
// fixed, friendlier message. Nest validation errors carry an array of messages in the body
// (`Error` stringifies it into `error.message` as "a,b"), so they are joined from the raw body.
export function getAuthErrorMessage(error) {
  if (!(error instanceof ApiError)) return FALLBACK_MESSAGE
  if (error.status === 429) return 'Too many attempts. Try again in a minute.'
  if (Array.isArray(error.body?.message)) return error.body.message.join('. ')
  return error.message || FALLBACK_MESSAGE
}
