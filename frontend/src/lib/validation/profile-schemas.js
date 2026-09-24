import { z } from 'zod'

// Client-side mirrors of the backend's profile rules (username + bio). The backend stays the
// source of truth; this file is the single frontend home for these rules.

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20
export const BIO_MAX_LENGTH = 160

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
