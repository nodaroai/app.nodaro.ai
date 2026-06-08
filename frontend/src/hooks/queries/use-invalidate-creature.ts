import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { queryKeys } from "@/lib/query-keys"

/**
 * Returns a memoized callback that invalidates the `assets.creatures(projectId,
 * userId)` React Query key — the canonical surface for the Creatures list shown
 * by the Library "Creatures" tab.
 *
 * Call this after any mutation that affects the list: save / delete / restore
 * / approve-main-image / asset-attachment. The callback identity is stable
 * across renders as long as `projectId` and `userId` don't change, so it's
 * safe to pass into `useEffect` / `useCallback` deps and mutation handlers
 * without triggering re-runs.
 *
 * Mirrors `useInvalidateObject` verbatim with object → creature substitution.
 * The `queryKeys.assets.creatures(...)` registry entry already exists at
 * query-keys.ts (alongside the objects entry) — no infrastructure work needed.
 */
export function useInvalidateCreature(
  projectId: string | undefined,
  userId: string | undefined,
): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.assets.creatures(projectId, userId),
    })
  }, [queryClient, projectId, userId])
}
