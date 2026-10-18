// @registry-enumerates prices a continuation's steps by estimateRunSetCredits over whatever node types the graph holds
/**
 * Can the payer cover a continue-from-failed of a use-case run (decided
 * 2026-10-13)? The steps it still runs, priced by the run-set estimate every
 * Render final quote reads, on the graph it executes (the earlier run's pin
 * applied), plus the fee it holds — asked before any row or hold, as the run
 * route asks it of a whole run. `null` in an edition without credits. The ee
 * billing module is reached through a dynamic import, as core must.
 */
import { withRunOverrides } from "@nodaro/shared/nodes"
import type { StoredInlineGraph } from "@nodaro/render-rules"
import { hasCredits } from "../config.js"
import type { BillingContext } from "../billing-context.js"

export type ContinueCover = { readonly ok: true; readonly totalCredits: number } | { readonly ok: false; readonly message: string }

/**
 * What the steps a continue-from-failed still runs are priced at: the run-set
 * estimate on the graph it executes (the earlier run's pin applied), without
 * the fee. The one figure the continue route's check and the outer run's
 * up-front check of a resumed node (resume-credits.ts) both read.
 */
export async function fromFailedStepCredits(input: {
  readonly graph: StoredInlineGraph
  readonly nodeIds: readonly string[]
  readonly overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
}): Promise<number> {
  const { estimateRunSetCredits } = await import("../../ee/billing/credits.js")
  const nodes = withRunOverrides(
    input.graph.nodes.map((n) => ({ ...n, data: { ...n.data } })),
    input.overrides,
  )
  return estimateRunSetCredits(
    nodes as unknown as Parameters<typeof estimateRunSetCredits>[0],
    input.graph.edges.map((e) => ({ ...e })),
    new Set(input.nodeIds),
  )
}

export async function fromFailedCover(input: {
  readonly userId: string
  readonly graph: StoredInlineGraph
  readonly nodeIds: readonly string[]
  readonly overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
  readonly feeCredits: number
  readonly billingContext?: BillingContext
  readonly webFreeMode: boolean
}): Promise<ContinueCover | null> {
  if (!hasCredits()) return null
  const { CreditsService, DEPLOYMENT_OUT_OF_CREDITS } = await import("../../ee/billing/credits.js")
  const steps = await fromFailedStepCredits(input)
  const totalCredits = steps + input.feeCredits
  const cover = await CreditsService.checkBalanceCovers(input.userId, totalCredits, input.billingContext, input.webFreeMode)
  if (cover.ok) return { ok: true, totalCredits }
  // A deployment's pool is the operator's: its balance is not the
  // requester's to see, and only the operator can top it up.
  return {
    ok: false,
    message:
      input.billingContext?.payer === "deployment"
        ? DEPLOYMENT_OUT_OF_CREDITS
        : `Continuing this episode is estimated at about ${totalCredits} credits; your balance is ${cover.balance}.`,
  }
}
