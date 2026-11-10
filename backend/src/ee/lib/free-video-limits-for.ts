// @registry-enumerates reads an account's balance through CreditsService — no node type is looked up, so not a @registry-lookup
/**
 * Whether the free-credit video limits apply to an account, and which: the
 * three facts the credit preflight reads — free-tier gates under the request's
 * payer (a member working in a paid workspace is not limited), an effective
 * tier of free, and no real payment on record — and never on a
 * deployment-payer instance, where the requester's own profile pays for
 * nothing. The balance route (which hands the editor the limits its menus lock
 * options by) and the server's new-node rule (`lib/new-node-models.ts`, which
 * skips a model the account cannot run) read this one decision.
 */
import { deploymentPayerActive } from "../../lib/deployment-payer.js"
import type { BillingContext } from "../../lib/billing-context.js"
import type { FreeVideoLimits } from "@nodaro/render-rules"
import { spendGates } from "../billing/org-entitlements.js"
import { hasPurchaseOnRecord } from "../billing/purchase-on-record.js"
import { CreditsService } from "../services/credits.js"
import { getFreeVideoLimits } from "./free-video-config.js"

/** Whether the limits apply to `userId`, whose effective tier is `effectiveTier`, under `billingContext`. */
export async function freeVideoLimitsApply(userId: string, effectiveTier: string, billingContext: BillingContext | undefined): Promise<boolean> {
  return (
    !deploymentPayerActive() &&
    effectiveTier === "free" &&
    spendGates(effectiveTier, { billingContext }).freeSemantics &&
    !(await hasPurchaseOnRecord(userId))
  )
}

/** The free-credit video limits that apply to `userId` under `billingContext`, or null when none do. */
export async function freeVideoLimitsFor(userId: string, billingContext?: BillingContext): Promise<FreeVideoLimits | null> {
  if (deploymentPayerActive()) return null
  const balance = await CreditsService.getBalance(userId)
  if (!(await freeVideoLimitsApply(userId, balance.effectiveTier, billingContext))) return null
  const limits = await getFreeVideoLimits()
  return limits.enabled ? limits : null
}
