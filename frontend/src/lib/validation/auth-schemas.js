import { z } from 'zod'

// Client-side mirrors of the backend's auth DTO rules. The backend stays the source of truth.

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .pipe(z.email('Enter a valid email address'))

// Sign-in only requires a password: length rules may change for existing accounts.
export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
})

export const signUpSchema = z
  .object({
    email,
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
      .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })
