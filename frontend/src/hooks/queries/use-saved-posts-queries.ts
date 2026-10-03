import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ListSavedPostsParams, SavePostInput, UpdateSavedPostInput } from "@nodaro/shared"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import { deleteOrAlreadyGone, deleteSavedPost, listSavedPosts, lookupSavedPosts, savePost, updateSavedPost } from "@/lib/api"

const PAGE_SIZE = 40

type WallFilters = Pick<ListSavedPostsParams, "platform" | "tag" | "q">

/** The inspiration wall, newest first, a page at a time. */
export function useSavedPostsWall(filters: WallFilters) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: queryKeys.savedPosts.list(filters),
    queryFn: ({ pageParam }) => listSavedPosts({ ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!user,
    staleTime: 30_000,
  })
}

/** Which of these posts are saved (postId -> save id). Quiet on failure: the
 *  bookmark then reads "not saved", and saving again is harmless (one save per post). */
export function useSavedPostLookup(postIds: readonly string[], enabled: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.savedPosts.lookup(postIds),
    queryFn: () => lookupSavedPosts(postIds),
    enabled: enabled && !!user && postIds.length > 0,
    staleTime: 30_000,
    retry: false,
  })
}

export function useSavedPostMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.savedPosts.all })
  const save = useMutation({
    mutationFn: (input: SavePostInput) => savePost(input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSavedPostInput }) => updateSavedPost(id, input),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    // Already removed elsewhere (404) is the state the click asked for.
    mutationFn: (id: string) => deleteOrAlreadyGone(deleteSavedPost(id)),
    onSuccess: invalidate,
  })
  return { save, update, remove }
}
