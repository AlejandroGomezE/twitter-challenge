import { z } from 'zod'
import { countCodePoints } from '@/lib/text'

// Client-side mirrors of the backend's profile rules (username, bio, display
// name). The backend stays the
// source of truth; this file is the single frontend home for these rules.

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20
export const BIO_MAX_LENGTH = 160
export const DISPLAY_NAME_MAX_LENGTH = 50

// MUST match the backend copy in `backend/src/modules/users/username.rules.ts`. These words would
// collide with app routes/API paths, so nobody can register them.
export const RESERVED_USERNAMES = [
  'me',
  'settings',
  'sign-in',
  'sign-up',
  'sign-out',
  'auth',
  'users',
  'u',
  'api',
  'admin',
  'root',
]

// Trimmed + lowercased before validation, like the backend stores it.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN_LENGTH, `Username must be at least ${USERNAME_MIN_LENGTH} characters`)
  .max(USERNAME_MAX_LENGTH, `Username must be at most ${USERNAME_MAX_LENGTH} characters`)
  .regex(/^[a-z0-9_]+$/, 'Only letters, numbers and underscores')
  .refine((value) => !RESERVED_USERNAMES.includes(value), "This username isn't available")

// Optional; an empty string clears the bio.
export const bioSchema = z
  .string()
  .trim()
  .max(BIO_MAX_LENGTH, `Bio must be ${BIO_MAX_LENGTH} characters or fewer`)

// Display name ("Name"): trimmed, 1–50 characters counted in Unicode code points (an emoji counts
// as 1, like the post composer and the backend), no line breaks. MUST match the backend rules in
// `backend/src/modules/users/username.rules.ts`.
const withDisplayNameRules = (schema: z.ZodString) =>
  schema
    .refine(
      (value) => countCodePoints(value) <= DISPLAY_NAME_MAX_LENGTH,
      `Name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`,
    )
    .refine((value) => !/[\r\n]/.test(value), "Name can't contain line breaks")

// Required (sign-up, and edit profile once a name is set: it can be changed, never cleared).
export const displayNameSchema = withDisplayNameRules(
  z.string().trim().min(1, 'Name is required'),
)

// Edit profile for a user without a name yet (`null`): may stay empty ('' = don't send it).
export const optionalDisplayNameSchema = withDisplayNameRules(z.string().trim())
