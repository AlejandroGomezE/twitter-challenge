import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { NewPostsContext, createNewPostsStore, syncNewPostsWithFeeds } from './new-posts-store'
import { useRealtimeEvent } from './use-realtime'

const isPostId = (id: unknown): id is string => typeof id === 'string' && id.length > 0

// Tracks the posts waiting behind Home's "N new posts" pill, per feed tab, from the realtime
// stream: `post.created` `{ id, following }` adds (For you always, Following only when
// `following`), `post.deleted` `{ id }` drops. Mounted in the signed-in shell (ProtectedRoute,
// inside RealtimeProvider) rather than in Home, so the counts keep building up while the user is
// on another page and are still there when they come back; signing out unmounts it, discarding
// them. Read it with `useNewPosts(tab)`.
interface NewPostsProviderProps {
  children: ReactNode
}

export function NewPostsProvider({ children }: NewPostsProviderProps) {
  const queryClient = useQueryClient()
  const [store] = useState(createNewPostsStore)

  useRealtimeEvent('post.created', (data) => {
    if (isPostId(data?.id)) store.add(data.id, data.following === true)
  })

  useRealtimeEvent('post.deleted', (data) => {
    if (isPostId(data?.id)) store.remove(data.id)
  })

  useEffect(() => syncNewPostsWithFeeds(queryClient, store), [queryClient, store])

  return <NewPostsContext.Provider value={store}>{children}</NewPostsContext.Provider>
}
