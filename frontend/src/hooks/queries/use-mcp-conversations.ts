import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { McpConversationList } from "@nodaro/sdk/workflows"
import { nodaroClient } from "@/lib/nodaro-client"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"

/** How often an open MCP Conversations tab refreshes while a conversation is live (still receiving steps). */
export const MCP_CONVERSATIONS_REFRESH_MS = 20_000

/**
 * The caller's MCP conversations of one month (`GET /v1/mcp-conversations`),
 * each a flow its assistant built. `month` undefined asks for the latest month
 * that has conversations. Keyed by the signed-in user, so another account on
 * this tab never sees the previous one's conversations from the cache.
 */
export function useMcpConversations(month: string | undefined, sources: readonly string[]) {
  const { user } = useAuth()
  const userId = user?.id ?? ""
  const sourceKey = [...sources].sort().join(",")
  return useQuery<McpConversationList>({
    queryKey: queryKeys.mcpConversations.list(userId, month ?? "", sourceKey),
    queryFn: () => nodaroClient.workflows.listMcpConversations({ month, sources }),
    enabled: userId !== "",
    staleTime: 10_000,
    // Only while something can change: a month with no live conversation is still.
    refetchInterval: (query) => (query.state.data?.data.some((c) => c.live) ? MCP_CONVERSATIONS_REFRESH_MS : false),
    placeholderData: keepPreviousData,
  })
}
