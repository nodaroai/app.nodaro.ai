import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArrowLeft, MessageSquare } from "lucide-react"
import { createClient } from "@/lib/supabase"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { mcpClientLabel } from "@/lib/mcp-client-label"
import { cn } from "@/lib/utils"

interface ConversationMarker {
  readonly client?: string
  readonly clientName?: string
}

/** The conversation marker of a workflow an assistant built (`settings.mcpConversation`), or null. */
function useMcpConversationMarker(workflowId: string) {
  return useQuery({
    queryKey: ["workflows", "mcp-conversation-marker", workflowId],
    queryFn: async (): Promise<ConversationMarker | null> => {
      const { data } = await createClient()
        .from("workflows")
        .select("conversation:settings->mcpConversation")
        .eq("id", workflowId)
        .maybeSingle()
      const marker = (data as { conversation?: ConversationMarker | null } | null)?.conversation
      return marker && typeof marker === "object" ? marker : null
    },
    enabled: workflowId !== "",
    staleTime: 5 * 60_000,
  })
}

/**
 * The strip over an MCP conversation's canvas: which assistant is building
 * it, and the way back to the MCP Conversations tab (the month's hub is a
 * container, not a canvas, so the sub-workflow breadcrumb has nowhere to go).
 */
export function McpConversationBanner({ workflowId }: { readonly workflowId: string }) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { data: marker } = useMcpConversationMarker(workflowId)
  if (!marker) return null
  return (
    <div className="flex items-center gap-3 border-b border-border bg-card/90 px-3 py-1.5 text-xs backdrop-blur-sm">
      <Link
        to="/projects?tab=mcpConversations"
        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} aria-hidden />
        {t("mcpconv.backToConversations")}
      </Link>
      <span className="flex items-center gap-1.5 text-primary-ink">
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        {t("mcpconv.builtLive", { client: mcpClientLabel(marker.client, marker.clientName) })}
      </span>
    </div>
  )
}
