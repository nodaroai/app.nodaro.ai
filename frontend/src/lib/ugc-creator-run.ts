/**
 * UGC Creator in the editor, beyond running it: the person's pick among the
 * options of a draw, the re-draw, and the buy-credits dialog its credits stop
 * opens (on the canvas and on a server run alike).
 */
import { toast } from "sonner"
import { UGC_CREATOR_CANDIDATES_KEY, ugcCreatorPick } from "@nodaro/shared/ugc"
import { getCachedUserId } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { ugcNodeMessageText } from "@/lib/ugc-copy"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { ExecutionContext } from "@/components/editor/workflow-editor/types"

/**
 * A run of the node is starting (`pending`: the re-draw's save before it runs) or running. Neither
 * a pick nor a re-draw is taken then: the run in hand was set up from the node before the pick,
 * and its new options would land over the picked creator.
 */
function runActive(data: unknown): boolean {
  const status = (data as { executionStatus?: unknown } | undefined)?.executionStatus
  return status === "pending" || status === "running"
}

/**
 * Use this one: the picked option becomes the creator, kept — the next run hands it on without
 * drawing again — and the options, their note and any failure go. False when refused: a
 * read-only canvas, a run of the node starting or running, or a pick of options that are gone
 * (a toast says so).
 */
export function pickUgcCreator(nodeId: string, index: number): boolean {
  const { nodes, updateNodeData, isReadOnly } = useWorkflowStore.getState()
  const node = nodes.find((n) => n.id === nodeId)
  if (isReadOnly || node?.type !== "ugc-creator" || runActive(node.data)) return false
  const picked = ugcCreatorPick((node.data as Record<string, unknown>)[UGC_CREATOR_CANDIDATES_KEY], index)
  if ("error" in picked) {
    toast.error(ugcNodeMessageText(picked.error))
    return false
  }
  updateNodeData(nodeId, {
    result: picked.result,
    ugcOutputs: picked.outputs,
    generatedImageUrl: picked.imageUrl,
    keepResult: true,
    executionStatus: "completed",
    errorMessage: undefined,
    [UGC_CREATOR_CANDIDATES_KEY]: undefined,
    optionFailed: undefined,
  })
  toast.success(tx("ugc.creator.keptNext"))
  return true
}

/** Show new options: Keep off, and the creator runs on its own — the one run its waiting options let through. Not while a run of it starts or runs. */
export function rerollUgcCreator(nodeId: string): void {
  const { nodes, updateNodeData, runSingleNode, isReadOnly } = useWorkflowStore.getState()
  if (isReadOnly || !runSingleNode || runActive(nodes.find((n) => n.id === nodeId)?.data)) return
  updateNodeData(nodeId, { keepResult: false })
  runSingleNode(nodeId, { redrawCreator: true })
}

/**
 * Open the editor's buy-credits dialog (the one the pre-run check opens) with the refusing
 * route's numbers. UGC Creator's credits stop is the one mid-run refusal that opens it.
 */
export function promptUgcCredits(
  ctx: Pick<ExecutionContext, "setInsufficientCreditsData" | "setShowInsufficientCredits">,
  s: { readonly required: number; readonly balance: number },
): void {
  const userId = getCachedUserId()
  const tier = (userId ? queryClient.getQueryData<{ tier?: string }>(queryKeys.credits.balance(userId))?.tier : undefined) ?? "free"
  ctx.setInsufficientCreditsData({ required: s.required, available: s.balance, tier })
  ctx.setShowInsufficientCredits(true)
}

/** A UGC Creator state that failed on a credits stop and names its shortfall, if any (a server run's `ugcShortfall`). */
export function ugcCreditStopOf(
  states: Readonly<Record<string, { readonly status?: string; readonly nodeType?: string; readonly output?: unknown }>>,
): { readonly nodeId: string; readonly required: number; readonly balance: number } | null {
  for (const [nodeId, s] of Object.entries(states)) {
    const shortfall = (s?.output as { ugcShortfall?: { required?: unknown; balance?: unknown } } | undefined)?.ugcShortfall
    if (s?.nodeType === "ugc-creator" && s.status === "failed" && typeof shortfall?.required === "number" && typeof shortfall.balance === "number") {
      return { nodeId, required: shortfall.required, balance: shortfall.balance }
    }
  }
  return null
}
