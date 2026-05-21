import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { queryKeys } from "@/lib/query-keys"

/**
 * Returns a memoized callback that invalidates the `assets.objects(projectId,
 * userId)` React Query key — the canonical surface for the Objects list shown
 * by `useObjects` and the Library "Objects" tab.
 *
 * Call this after any mutation that affects the list: save / delete / restore
 * / approve-main-image / asset-attachment. The callback identity is stable
 * across renders as long as `projectId` and `userId` don't change, so it's
 * safe to pass into `useEffect` / `useCallback` deps and mutation handlers
 * without triggering re-runs.
 *
 * Mirrors `useInvalidateLocation` at use-invalidate-location.ts:1-30 verbatim
 * with location → object substitution. The `queryKeys.assets.objects(...)`
 * registry entry already exists at query-keys.ts:63-64 (Phase C1c
 * verification — no infrastructure work needed).
 */
export function useInvalidateObject(
  projectId: string | undefined,
  userId: string | undefined,
): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.assets.objects(projectId, userId),
    })
  }, [queryClient, projectId, userId])
}
