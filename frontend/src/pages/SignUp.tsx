import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getAuthErrorMessage } from '@/lib/auth/auth-error-message'
import { useAuth } from '@/lib/auth/use-auth'
import { PASSWORD_MIN_LENGTH, signUpSchema } from '@/lib/validation/auth-schemas'
import { DISPLAY_NAME_MAX_LENGTH } from '@/lib/validation/profile-schemas'

export function SignUp() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: { displayName: '', username: '', email: '', password: '', confirmPassword: '' },
  })

  // `confirmPassword` is client-only; the API takes the credentials, the username and the name.
  const onSubmit = async ({
    email,
    password,
    username,
    displayName,
  }: z.output<typeof signUpSchema>) => {
    setServerError(null)
    try {
      await signUp({ email, password, username, displayName })
      navigate('/', { replace: true })
    } catch (error) {
      setServerError(getAuthErrorMessage(error))
    }
  }

  const displayNameDescribedBy = errors.displayName
    ? 'sign-up-display-name-hint sign-up-display-name-error'
    : 'sign-up-display-name-hint'

  const usernameDescribedBy = errors.username
    ? 'sign-up-username-hint sign-up-username-error'
    : 'sign-up-username-hint'

  const passwordDescribedBy = errors.password
    ? 'sign-up-password-hint sign-up-password-error'
    : 'sign-up-password-hint'

  return (
    <AuthLayout title="Create an account">
      <Card className="w-full rounded-2xl border bg-card shadow-sm ring-0">
        <CardHeader>
          <CardTitle>
            <h1>Create an account</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              {serverError && (
                <Alert variant="destructive">
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={Boolean(errors.displayName)}>
                <FieldLabel htmlFor="sign-up-display-name">Name</FieldLabel>
                <Input
                  id="sign-up-display-name"
                  type="text"
                  autoComplete="name"
                  aria-invalid={Boolean(errors.displayName)}
                  aria-describedby={displayNameDescribedBy}
                  {...register('displayName')}
                />
                <FieldDescription id="sign-up-display-name-hint">
                  Up to {DISPLAY_NAME_MAX_LENGTH} characters. Shown next to your username.
                </FieldDescription>
                <FieldError id="sign-up-display-name-error" errors={[errors.displayName]} />
              </Field>
              <Field data-invalid={Boolean(errors.username)}>
                <FieldLabel htmlFor="sign-up-username">Username</FieldLabel>
                <Input
                  id="sign-up-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.username)}
                  aria-describedby={usernameDescribedBy}
                  {...register('username')}
                />
                <FieldDescription id="sign-up-username-hint">
                  3–20 characters: letters, numbers, underscores.
                </FieldDescription>
                <FieldError id="sign-up-username-error" errors={[errors.username]} />
              </Field>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
                <Input
                  id="sign-up-email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'sign-up-email-error' : undefined}
                  {...register('email')}
                />
                <FieldError id="sign-up-email-error" errors={[errors.email]} />
              </Field>
              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="sign-up-password">Password</FieldLabel>
                <Input
                  id="sign-up-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={passwordDescribedBy}
                  {...register('password')}
                />
                <FieldDescription id="sign-up-password-hint">
                  At least {PASSWORD_MIN_LENGTH} characters.
                </FieldDescription>
                <FieldError id="sign-up-password-error" errors={[errors.password]} />
              </Field>
              <Field data-invalid={Boolean(errors.confirmPassword)}>
                <FieldLabel htmlFor="sign-up-confirm-password">Confirm password</FieldLabel>
                <Input
                  id="sign-up-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(errors.confirmPassword)}
                  aria-describedby={
                    errors.confirmPassword ? 'sign-up-confirm-password-error' : undefined
                  }
                  {...register('confirmPassword')}
                />
                <FieldError
                  id="sign-up-confirm-password-error"
                  errors={[errors.confirmPassword]}
                />
              </Field>
              <Button type="submit" disabled={isSubmitting} className="h-10 rounded-full font-semibold">
                {isSubmitting && <Spinner aria-hidden="true" />}
                Create account
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-muted-foreground">
          <span>
            Already have an account?{' '}
            <Link to="/sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </span>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
