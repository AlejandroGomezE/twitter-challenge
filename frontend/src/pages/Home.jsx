import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get('/'),
  })
}

export function Home() {
  const { data, isLoading, isError, error } = useHealthCheck()

  return (
    <div className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>twitter-clone</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-muted-foreground">Checking backend…</p>}
          {isError && <p className="text-destructive">Backend unreachable: {error.message}</p>}
          {data && <p>{data.message}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
