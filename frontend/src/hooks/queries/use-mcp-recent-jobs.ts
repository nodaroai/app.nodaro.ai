import { useInfiniteQuery } from "@tanstack/react-query"
import { getJobs } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"

/** How many MCP-made jobs one "show more" loads (the first page included). */
export const MCP_JOBS_PAGE_SIZE = 24

/**
 * The caller's jobs an MCP client (Claude, ChatGPT, …) made — single
 * generations that are not part of any workflow, so the workflow grid above
 * them cannot show them. `GET /v1/jobs?source=mcp`, newest first, a page at a
 * time: the whole history is reachable, never only the latest page.
 */
export function useMcpRecentJobs() {
  // Keyed by the signed-in user: another account signing in on this tab must
  // never be shown the previous one's jobs from the cache.
  const { user } = useAuth()
  const userId = user?.id ?? ""
  return useInfiniteQuery({
    queryKey: queryKeys.jobs.mcpRecent(userId),
    queryFn: ({ pageParam }) => getJobs(undefined, pageParam, MCP_JOBS_PAGE_SIZE, { source: "mcp" }),
    initialPageParam: undefined as string | undefined,
    // A page may hold fewer rows than asked and still carry a `next`: page on `next` alone.
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
    staleTime: 30_000,
    enabled: userId !== "",
  })
}
