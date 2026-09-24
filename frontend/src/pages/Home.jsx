import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/use-auth';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get('/'),
  });
}

export function Home() {
  const { user } = useAuth();
  const { data, isLoading, isError, error } = useHealthCheck();

  return (
    <div className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>twitter-clone</CardTitle>
          <CardAction>
            {/* Sign-out always goes through the /sign-out page (the single sign-out path). */}
            <Button asChild variant="outline" size="sm">
              <Link to="/sign-out">Sign out</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {user && <p className="text-muted-foreground">Signed in as {user.email}</p>}
          {isLoading && <p className="text-muted-foreground">Checking backend…</p>}
          {isError && <p className="text-destructive">Backend unreachable: {error.message}</p>}
          {data && <p>{data.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
