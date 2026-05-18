import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { queryKeys } from "@/lib/query-keys"

/**
 * Returns a memoized callback that invalidates the `assets.locations(projectId,
 * userId)` React Query key — the canonical surface for the Locations list
 * shown by `useLocations` and the Library "Locations" tab.
 *
 * Call this after any mutation that affects the list: save / delete / restore
 * / approve-main-image / asset-attachment. The callback identity is stable
 * across renders as long as `projectId` and `userId` don't change, so it's
 * safe to pass into `useEffect` / `useCallback` deps and mutation handlers
 * without triggering re-runs.
 */
export function useInvalidateLocation(
  projectId: string | undefined,
  userId: string | undefined,
): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.assets.locations(projectId, userId),
    })
  }, [queryClient, projectId, userId])
}
