import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/use-auth';
import { Link } from 'react-router';

export function Home() {
  const { user } = useAuth();

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
        <CardContent>
          {user && <p className="text-muted-foreground">Signed in as {user.email}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
