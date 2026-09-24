import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useProfile } from '@/hooks/use-profile';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { profileQueryKey, updateMyProfile } from '@/lib/api/users';
import { AUTH_ME_QUERY_KEY } from '@/lib/auth/auth-context';
import { useAuth } from '@/lib/auth/use-auth';
import { cn } from '@/lib/utils';
import { BIO_MAX_LENGTH, bioSchema, usernameSchema } from '@/lib/validation/profile-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';

const editProfileSchema = z.object({
  username: usernameSchema,
  bio: bioSchema,
});

// Loads the current bio (the `me` payload has no bio), then renders the form prefilled with it.
export function EditProfile() {
  const { user } = useAuth();
  const { data: profile, isPending, isError, isFetching, refetch } = useProfile(user.username);

  if (isPending) {
    return (
      <EditProfileShell username={user.username}>
        <div className="flex flex-col gap-4" aria-busy="true">
          <Spinner className="sr-only" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-16 w-full" />
        </div>
      </EditProfileShell>
    );
  }

  if (isError) {
    return (
      <EditProfileShell username={user.username}>
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertDescription>
              Couldn&apos;t load your profile. Check your connection and try again.
            </AlertDescription>
          </Alert>
          <Button
            onClick={() => refetch()}
            disabled={isFetching}
            className="self-start rounded-full px-5 font-semibold"
          >
            {isFetching && <Spinner aria-hidden="true" />}
            Retry
          </Button>
        </div>
      </EditProfileShell>
    );
  }

  return (
    <EditProfileShell username={user.username}>
      <EditProfileForm currentUsername={user.username} currentBio={profile.bio ?? ''} />
    </EditProfileShell>
  );
}

function EditProfileForm({ currentUsername, currentBio }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(editProfileSchema),
    defaultValues: { username: currentUsername, bio: currentBio },
  });

  const mutation = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: (updated) => {
      const { id, email, username, bio, createdAt } = updated;
      // Seed the new profile entry first so the profile page renders the saved data immediately.
      queryClient.setQueryData(profileQueryKey(username), { username, bio, createdAt });
      // `me` keeps its own shape ({ id, email, username }), as AuthProvider/sign-in store it.
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, { id, email, username });
      if (currentUsername.toLowerCase() !== username.toLowerCase()) {
        queryClient.removeQueries({ queryKey: profileQueryKey(currentUsername), exact: true });
      }
      navigate(`/u/${username}`, { replace: true });
    },
  });

  // Values arrive already trimmed/lowercased by the schema; only changed fields are sent.
  const onSubmit = ({ username, bio }) => {
    const patch = {};
    if (username !== currentUsername.toLowerCase()) patch.username = username;
    if (bio !== currentBio) patch.bio = bio;

    if (Object.keys(patch).length === 0) {
      navigate(`/u/${currentUsername}`, { replace: true });
      return;
    }
    mutation.mutate(patch);
  };

  // Counts the trimmed text, exactly what the schema (and the backend) measure.
  const bioValue = useWatch({ control, name: 'bio' }) ?? '';
  const bioLength = bioValue.trim().length;
  const bioTooLong = bioLength > BIO_MAX_LENGTH;

  const usernameDescribedBy = errors.username
    ? 'edit-profile-username-hint edit-profile-username-error'
    : 'edit-profile-username-hint';
  const bioDescribedBy = errors.bio
    ? 'edit-profile-bio-counter edit-profile-bio-error'
    : 'edit-profile-bio-counter';

  const isSaving = mutation.isPending;

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)}>
      <FieldGroup>
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(mutation.error)}</AlertDescription>
          </Alert>
        )}
        <Field data-invalid={Boolean(errors.username)}>
          <FieldLabel htmlFor="edit-profile-username">Username</FieldLabel>
          <Input
            id="edit-profile-username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(errors.username)}
            aria-describedby={usernameDescribedBy}
            {...register('username')}
          />
          <FieldDescription id="edit-profile-username-hint">
            3–20 characters: letters, numbers, underscores.
          </FieldDescription>
          <FieldError id="edit-profile-username-error" errors={[errors.username]} />
        </Field>
        <Field data-invalid={Boolean(errors.bio)}>
          <FieldLabel htmlFor="edit-profile-bio">Bio</FieldLabel>
          <Textarea
            id="edit-profile-bio"
            rows={3}
            aria-invalid={Boolean(errors.bio)}
            aria-describedby={bioDescribedBy}
            {...register('bio')}
          />
          <FieldDescription
            id="edit-profile-bio-counter"
            className={cn('text-right tabular-nums', bioTooLong && 'text-destructive')}
          >
            {bioLength}/{BIO_MAX_LENGTH}
          </FieldDescription>
          <FieldError id="edit-profile-bio-error" errors={[errors.bio]} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            asChild
            variant="outline"
            className="rounded-full border-foreground/20 px-5 font-semibold"
          >
            <Link to={`/u/${currentUsername}`}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={isSaving} className="rounded-full px-5 font-semibold">
            {isSaving && <Spinner aria-hidden="true" />}
            Save
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

// Inside the app shell's center column: sticky header (back to your profile) + padded content.
function EditProfileShell({ username, children }) {
  return (
    <>
      <PageHeader
        title="Edit profile"
        leading={
          <Button asChild variant="ghost" size="icon-lg" className="rounded-full">
            <Link to={`/u/${username}`} aria-label="Back to your profile">
              <ArrowLeft className="size-5" aria-hidden="true" />
            </Link>
          </Button>
        }
      />
      <div className="px-5 py-6 sm:px-6">{children}</div>
    </>
  );
}
