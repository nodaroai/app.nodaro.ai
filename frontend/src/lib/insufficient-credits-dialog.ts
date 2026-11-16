import { getCachedUserId } from "@/hooks/use-auth"
import { tx } from "@/lib/i18n"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { ExecutionContext } from "@/components/editor/workflow-editor/types"

/** What the editor's not-enough-credits dialog shows: what the run needs and what the payer has, RAW credits. */
export interface CreditsShortfall {
  readonly required: number
  readonly available: number
  /** `required` is the run's estimate, not its price (a use-case node's refusal): said in the dialog's note. */
  readonly estimate?: true
}

/**
 * Open the editor's not-enough-credits dialog with these figures, and the plan
 * the account's cached balance names ("free" until it is loaded). The one
 * opener for every refusal that opens it from a run: a node's refused start
 * (`credits-shortfall.ts`) and UGC Creator's credits stop (`promptUgcCredits`).
 * A figure that is the run's estimate says so in the dialog's `note`, the slot
 * the editor's own balance check uses for a UGC hold above its price (the two
 * never meet: that check opens the dialog itself, and a refusal whose figure
 * is a hold names no figures at all).
 */
export function openInsufficientCreditsDialog(
  setters: Pick<ExecutionContext, "setInsufficientCreditsData" | "setShowInsufficientCredits">,
  shortfall: CreditsShortfall,
): void {
  const userId = getCachedUserId()
  const tier = (userId ? queryClient.getQueryData<{ tier?: string }>(queryKeys.credits.balance(userId))?.tier : undefined) ?? "free"
  setters.setInsufficientCreditsData({
    required: shortfall.required,
    available: shortfall.available,
    tier,
    ...(shortfall.estimate ? { note: tx("credits.estimateNote") } : {}),
  })
  setters.setShowInsufficientCredits(true)
}
