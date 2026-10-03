import { useQuery } from "@tanstack/react-query"
import { listWorkflowTriggers } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { webhookEndpointUrl } from "@/lib/webhook-url"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export interface WebhookTriggerUrl {
  /** The absolute URL to post to, or null when this node has no trigger row yet. */
  readonly url: string | null
  /** The token inside the URL — the only credential the endpoint asks for. */
  readonly token: string | null
  readonly loading: boolean
}

/**
 * The URL of a Webhook Trigger node, read from the trigger row the server
 * keeps for it. Saving a workflow projects each trigger node onto a
 * `workflow_triggers` row (`config.nodeId` names the node) and the token lives
 * only there — the node data never carried it, so the editor used to show
 * "Configure webhook…" and never the URL. Refetched after every trigger sync
 * (`trigger-sync-after-save.ts` invalidates this query).
 */
export function useWebhookTriggerUrl(nodeId: string | undefined): WebhookTriggerUrl {
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workflows.triggers(workflowId ?? ""),
    queryFn: () => listWorkflowTriggers(workflowId!),
    enabled: !!workflowId && !!nodeId,
    staleTime: 30_000,
  })
  const row = data?.find(
    (trigger) => trigger.type === "webhook" && (trigger.config as { nodeId?: unknown } | null)?.nodeId === nodeId,
  )
  return {
    url: row?.webhookUrl ? webhookEndpointUrl(row.webhookUrl) : null,
    token: row?.webhookToken ?? null,
    loading: isLoading && !!workflowId && !!nodeId,
  }
}
