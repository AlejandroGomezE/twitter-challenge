import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getAuthErrorMessage } from '@/lib/auth/auth-error-message'
import { getRedirectTarget } from '@/lib/auth/redirect-target'
import { useAuth } from '@/lib/auth/use-auth'
import { signInSchema } from '@/lib/validation/auth-schemas'

export function SignIn() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [serverError, setServerError] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values) => {
    setServerError(null)
    try {
      await signIn(values)
      // PublicOnlyRoute already redirects to the same target once the user is seeded; this keeps
      // SignIn correct when it is rendered outside that guard.
      navigate(getRedirectTarget(location.state?.from), { replace: true })
    } catch (error) {
      setServerError(getAuthErrorMessage(error))
    }
  }

  return (
    <AuthLayout title="Sign in">
      <Card className="w-full rounded-2xl border bg-card shadow-sm ring-0">
        <CardHeader>
          <CardTitle>
            <h1>Sign in</h1>
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
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
                <Input
                  id="sign-in-email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'sign-in-email-error' : undefined}
                  {...register('email')}
                />
                <FieldError id="sign-in-email-error" errors={[errors.email]} />
              </Field>
              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
                <Input
                  id="sign-in-password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'sign-in-password-error' : undefined}
                  {...register('password')}
                />
                <FieldError id="sign-in-password-error" errors={[errors.password]} />
              </Field>
              <Button type="submit" disabled={isSubmitting} className="h-10 rounded-full font-semibold">
                {isSubmitting && <Spinner aria-hidden="true" />}
                Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-muted-foreground">
          <span>
            New here?{' '}
            <Link to="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
              Create an account
            </Link>
          </span>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
