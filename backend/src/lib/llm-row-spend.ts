// @reads-none reads one jobs row through the service-role client; reads no repo file
/**
 * What a metered LLM job's ROW recorded billed — its running ledger (the
 * server-only ledger column, written by a worker's `noteSpend`
 * after every answered call) and its cumulative `provider_cost` — turned into
 * an `LlmSpend` a settle can charge. Shared by the worker failure net, the
 * cancel (R45: a cancel with nothing in flight charges the row's billed
 * actual) and the reconcile sweep's cancelled-hold pass, so the three read a
 * row's billing one way. A leaf: no worker module is loaded to read it.
 */
import type { LlmSpend } from "./llm-spend.js"

/**
 * The running billing ledger on a job's row (the server-only ledger column,
 * written by {@link WorkerLlmBilling.noteSpend}), with its `provider_cost`.
 * Absent fields when the row recorded none; `readFailed` when the row could
 * not be read (a returned error or a throw) — never confused with "nothing
 * recorded" (D10).
 */
export async function rowBilling(jobId: string): Promise<{ ledger?: Record<string, unknown>; providerCost?: number; readFailed?: true }> {
  const { readLlmBillingLedgerAndCost } = await import("./llm-billing-ledger.js")
  const read = await readLlmBillingLedgerAndCost(jobId)
  if (!read.ok) {
    console.warn(`[worker] Job ${jobId}: could not read its billing ledger: ${read.error}`)
    return { readFailed: true }
  }
  return {
    ...(read.ledger ? { ledger: read.ledger as unknown as Record<string, unknown> } : {}),
    ...(read.providerCost !== undefined ? { providerCost: read.providerCost } : {}),
  }
}

/** A served lane named in a ledger's `lanes`, for a figure recorded without per-attempt detail. */
export function ledgerLane(ledger: Record<string, unknown> | undefined): string {
  const lanes = Array.isArray(ledger?.lanes) ? (ledger.lanes as unknown[]) : []
  const lane = lanes.find((l) => l === "kie" || l === "direct-gemini" || l === "direct-anthropic")
  return typeof lane === "string" ? lane : "kie"
}

/**
 * The spend a metered job's ROW recorded billed, for a settle that has no
 * handler spend (the failure net, the cancelled-hold sweep): the running
 * ledger `noteSpend` writes after every answered call and BEFORE a billed
 * failure is rethrown (every earlier BullMQ attempt's too, R31) — its
 * attempts, else its cumulative `provider_cost` as one stated charge. The
 * attempts can be STALE beside a higher `provider_cost` (a `noteSpend` whose
 * read failed writes the cost alone): when the cumulative cost exceeds what
 * the attempts sum to, it is the charge instead — one or the other, never
 * both. `fromRow` — the row recorded a billed figure; `readFailed` — the row
 * could not be read (what was billed is unknown: never settled or refunded on
 * a guess). Null when the charge id names no model.
 */
export async function meteredSpendFromRow(
  jobId: string,
  chargeId: string,
): Promise<{ spend: LlmSpend; modelId: string; fromRow: boolean; readFailed: boolean } | null> {
  const { LlmSpend: Spend } = await import("./llm-spend.js")
  const { parseMeteredLlmId } = await import("../ee/billing/metered-llm-id.js")
  const modelId = parseMeteredLlmId(chargeId)?.modelId
  if (!modelId) return null
  const spend = new Spend()
  const { ledger, providerCost, readFailed } = await rowBilling(jobId)
  const carried = Array.isArray(ledger?.attempts) ? (ledger.attempts as unknown[]) : []
  const statedCharge = typeof providerCost === "number" && providerCost > 0 ? providerCost : undefined
  let statedExceedsAttempts = false
  if (carried.length > 0 && statedCharge !== undefined) {
    let fromAttempts: LlmSpend | undefined
    try {
      fromAttempts = new Spend()
      fromAttempts.add(modelId, { modelId, system: "", messages: [] }, { output: { attempts: carried } as never })
    } catch {
      fromAttempts = undefined // unreadable attempts: the stated cost stands for them
    }
    let attemptsCostUsd: number | undefined
    try {
      attemptsCostUsd = fromAttempts?.costUsd
    } catch {
      // Unpriceable attempts (a missing rate): kept as recorded — the settle owns that case.
      attemptsCostUsd = Number.POSITIVE_INFINITY
    }
    // A rounding-level tolerance: the row's cost IS the attempts' sum when both were written together.
    statedExceedsAttempts = attemptsCostUsd === undefined || statedCharge > attemptsCostUsd + 1e-9
  }
  let fromRow = false
  try {
    if (carried.length > 0 && !statedExceedsAttempts) {
      spend.add(modelId, { modelId, system: "", messages: [] }, { output: { attempts: carried } as never })
      fromRow = true
    } else if (statedCharge !== undefined) {
      spend.add(modelId, { modelId, system: "", messages: [] }, {
        output: { attempts: [{ lane: ledgerLane(ledger), modelId, requestChars: 0, inputTokens: 0, outputTokens: 0, creditsUsd: statedCharge }] } as never,
      })
      fromRow = true
    }
  } catch (err) {
    console.warn(`[worker] Job ${jobId}: the row's recorded spend could not be read:`, err)
  }
  return { spend, modelId, fromRow, readFailed: readFailed === true }
}
