import { getCachedUserId } from "@/hooks/use-auth"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { ExecutionContext } from "@/components/editor/workflow-editor/types"

/** What the editor's not-enough-credits dialog shows: what the run needs and what the payer has, RAW credits. */
export interface CreditsShortfall {
  readonly required: number
  readonly available: number
}

/**
 * Open the editor's not-enough-credits dialog with these figures, and the plan
 * the account's cached balance names ("free" until it is loaded). The one
 * opener for every refusal that opens it from a run: a node's refused start
 * (`credits-shortfall.ts`) and UGC Creator's credits stop (`promptUgcCredits`).
 */
export function openInsufficientCreditsDialog(
  setters: Pick<ExecutionContext, "setInsufficientCreditsData" | "setShowInsufficientCredits">,
  shortfall: CreditsShortfall,
): void {
  const userId = getCachedUserId()
  const tier = (userId ? queryClient.getQueryData<{ tier?: string }>(queryKeys.credits.balance(userId))?.tier : undefined) ?? "free"
  setters.setInsufficientCreditsData({ required: shortfall.required, available: shortfall.available, tier })
  setters.setShowInsufficientCredits(true)
}
