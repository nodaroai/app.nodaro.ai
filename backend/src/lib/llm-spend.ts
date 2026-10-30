/**
 * The spend of a metered LLM job — {@link LlmSpend}, every call it made, each
 * attempt costed on the lane that served it ({@link llmAttemptCostUsd}) — and
 * the record a settle writes ({@link LlmBillingRecord}). Pure; re-exported by
 * `./llm-billing.ts`, the shim every caller bills through. A leaf of its own so
 * a reader of a row's recorded spend (`./llm-row-spend.ts`) never loads the
 * billing entry points.
 */
import { getLlmModel } from "@nodaro/shared/llm-models"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { LlmStreamAbortedError, LlmStreamResponseError } from "./llm-errors.js"
import { kieCostUsd, kieInputUntrusted, requestChars } from "./llm/kie-cost.js"
import { calculateLlmCost, llmPrimaryLane } from "./pricing/llm-cost.js"
import { directLaneVendor } from "./llm/direct-vendor.js"
import type { StructuredLlmOutput } from "./llm/structured.js"
import type { LlmAttemptSpend, LlmRequest, LlmResponse, LlmServedLane } from "./llm/types.js"

/** What a metered job cost, written to `jobs.provider_cost` (`costUsd`, admin-only) and the server-only billing ledger column (`./llm-billing-ledger.ts`; B14, C10). */
export interface LlmBillingRecord {
  /** The provider cost of every call, summed (USD) — before the floor. */
  costUsd: number
  /**
   * Where the figure came from — the least certain source any attempt used, in
   * this order: `floor` (it computed below `CREDIT_BASE_USD`, so the floor was
   * charged), `abort-estimate` (a stopped stream's estimate),
   * `kie-size-estimate` (a KIE Claude / GPT-6 call costed from its request
   * size), `provider-usage` (the adapter's cost or the lane rate × reported
   * tokens), `kie-stated` (KIE's own stated charge for every attempt).
   */
  source: "kie-stated" | "kie-size-estimate" | "provider-usage" | "abort-estimate" | "floor"
  /** Attempts billed (each structured re-ask, fallback and repair counts). */
  calls: number
  /** The lane of each attempt, in order. */
  lanes: LlmServedLane[]
}

type AttemptSource = Exclude<LlmBillingRecord["source"], "floor">

function attemptSource(a: LlmAttemptSpend): AttemptSource {
  if (a.estimated) return "abort-estimate"
  if (a.creditsUsd !== undefined) return "kie-stated"
  if (a.lane === "kie" && kieInputUntrusted(a.modelId)) return "kie-size-estimate"
  return "provider-usage"
}

/**
 * What one attempt cost (USD). The rules, in order:
 *  1. KIE's stated charge (`creditsUsd`) when the reply carried one;
 *  2. on the `kie` lane for a model whose reported input count is untrusted
 *     (`kieInputUntrusted`: Claude, GPT-6): the size estimate — the request's
 *     characters ÷ 4 in, the reported output tokens out — at the KIE rate
 *     (`kieCostUsd`);
 *  3. the adapter's `providerCost` — unless it is 0 beside real tokens (the
 *     rate-table fallback that found no rate, `llmCostOrZero`), which is
 *     recomputed by rule 4;
 *  4. the lane's rate × the reported tokens (`calculateLlmCost`).
 * Each rate-based rule throws `LlmRateMissingError` on a missing rate; none
 * ever returns 0 for want of one.
 */
export function llmAttemptCostUsd(a: LlmAttemptSpend): number {
  if (a.creditsUsd !== undefined) return a.creditsUsd
  if (a.lane === "kie" && kieInputUntrusted(a.modelId)) {
    return kieCostUsd(a.modelId, { promptChars: a.requestChars, answerChars: a.outputTokens * 4 })
  }
  // A 0 cost beside real tokens is a rate-table figure that found no rate
  // (`llmCostOrZero`), never a free call: recompute it, which throws when the
  // rate is truly missing.
  if (a.providerCost !== undefined && !(a.providerCost === 0 && (a.inputTokens > 0 || a.outputTokens > 0))) return a.providerCost
  return calculateLlmCost(a.modelId, { inputTokens: a.inputTokens, outputTokens: a.outputTokens }, a.lane === "kie" ? "kie" : "direct")
}

/** The served lane the router asks first for this request — for a billed failure that does not name its lane. */
function primaryServedLane(modelId: string, request: LlmRequest): LlmServedLane {
  const model = getLlmModel(modelId)
  if (!model || llmPrimaryLane(model, request) === "kie") return "kie"
  return directLaneVendor(model) === "google" ? "direct-gemini" : "direct-anthropic"
}

const SERVED_LANES: ReadonlySet<string> = new Set<LlmServedLane>(["kie", "direct-gemini", "direct-anthropic"])

function count(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`LlmSpend.add: ${what} must be a finite number ≥ 0, got ${String(value)}`)
  }
  return value
}

function optionalCount(value: unknown, what: string): number | undefined {
  return value === undefined ? undefined : count(value, what)
}

function servedLaneOf(value: unknown, what: string): LlmServedLane {
  if (typeof value !== "string" || !SERVED_LANES.has(value)) {
    throw new TypeError(`LlmSpend.add: ${what} must be one of kie, direct-gemini, direct-anthropic, got ${String(value)}`)
  }
  return value as LlmServedLane
}

/**
 * One attempt, checked: every count a finite number ≥ 0 and a known lane — so a
 * malformed outcome (a plugin's, a mock's) fails LOUDLY at `add`, never as a
 * NaN charge that the settle could not commit.
 */
function checkedAttempt(a: {
  lane: unknown; modelId: unknown; requestChars: unknown; inputTokens: unknown; outputTokens: unknown
  providerCost?: unknown; creditsUsd?: unknown; estimated?: unknown
}): LlmAttemptSpend {
  if (typeof a.modelId !== "string" || a.modelId === "") throw new TypeError("LlmSpend.add: modelId must be a model id")
  const providerCost = optionalCount(a.providerCost, "providerCost")
  const creditsUsd = optionalCount(a.creditsUsd, "creditsUsd")
  return {
    lane: servedLaneOf(a.lane, "lane"),
    modelId: a.modelId,
    requestChars: count(a.requestChars, "requestChars"),
    inputTokens: count(a.inputTokens, "inputTokens"),
    outputTokens: count(a.outputTokens, "outputTokens"),
    ...(providerCost !== undefined ? { providerCost } : {}),
    ...(creditsUsd !== undefined ? { creditsUsd } : {}),
    ...(a.estimated === true ? { estimated: true as const } : {}),
  }
}

function billed(u: { inputTokens: number; outputTokens: number; providerCost?: number; creditsUsd?: number }): boolean {
  return u.inputTokens > 0 || u.outputTokens > 0 || (u.providerCost ?? 0) > 0 || (u.creditsUsd ?? 0) > 0
}

/** The structured-call usage on an error, read by shape (`StructuredLlmError.usage`). */
interface UsageWithAttempts {
  inputTokens: number
  outputTokens: number
  providerCost?: number
  attempts?: unknown
}

/**
 * The spend of one metered job: every call it made, each attempt costed on
 * its own lane ({@link llmAttemptCostUsd}). A6: a multi-call feature adds
 * EVERY call — a fallback model, a repair, each parallel batch.
 */
export class LlmSpend {
  readonly #attempts: LlmAttemptSpend[] = []

  /**
   * Record a call's outcome:
   *  - `{ response }` — one answered attempt (billed even when it computed 0:
   *    the floor applies);
   *  - `{ output }` — a structured call: each of its `attempts` (a
   *    `StructuredLlmOutput`, or a plugin's `completeStructuredMetered`
   *    success, which carries them); without attempts, one attempt from its
   *    `lane` and totals;
   *  - `{ error }` — what the failure billed: a structured failure's attempts
   *    (`usage.attempts`, a plugin's failed `completeStructuredMetered` result
   *    included), a stopped stream's estimate, a usage-carrying failure's usage
   *    on the lane it names (found on the `cause` chain); nothing for a failure
   *    that billed nothing (a transport error), which is then refunded.
   *
   * Throws `TypeError` for a malformed outcome (an unknown lane, a count that
   * is not a finite number ≥ 0) — never records a figure the settle could not
   * charge.
   */
  add(
    modelId: string,
    request: LlmRequest,
    outcome: { response: LlmResponse } | { output: StructuredLlmOutput<unknown> } | { error: unknown },
  ): void {
    if (!outcome || typeof outcome !== "object") throw new TypeError("LlmSpend.add: outcome must be { response } | { output } | { error }")
    if ("response" in outcome) {
      const r = outcome.response as Partial<LlmResponse> | undefined
      if (!r || typeof r !== "object") throw new TypeError("LlmSpend.add: response must be an LlmResponse")
      this.#attempts.push(checkedAttempt({
        lane: r.lane,
        modelId,
        requestChars: requestChars(request),
        inputTokens: r.usage?.inputTokens ?? 0,
        outputTokens: r.usage?.outputTokens ?? 0,
        providerCost: r.providerCost,
        creditsUsd: r.creditsUsd,
      }))
      return
    }
    if ("output" in outcome) {
      const o = outcome.output as Partial<StructuredLlmOutput<unknown>> | undefined
      if (!o || typeof o !== "object") throw new TypeError("LlmSpend.add: output must be a structured call's output")
      if (Array.isArray(o.attempts) && o.attempts.length > 0) {
        this.#attempts.push(...o.attempts.map((a) => checkedAttempt(a)))
        return
      }
      // An output without per-attempt detail: one attempt from its totals.
      this.#attempts.push(checkedAttempt({
        lane: o.lane,
        modelId,
        requestChars: requestChars(request),
        inputTokens: o.inputTokens,
        outputTokens: o.outputTokens,
        providerCost: o.providerCost,
      }))
      return
    }
    if (!("error" in outcome)) throw new TypeError("LlmSpend.add: outcome must be { response } | { output } | { error }")
    this.#addFailure(modelId, request, outcome.error)
  }

  #addFailure(modelId: string, request: LlmRequest, error: unknown): void {
    let cur: unknown = error
    for (let depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
      if (cur instanceof LlmStreamResponseError) {
        const u = cur.usage
        if (billed(u)) {
          this.#attempts.push(checkedAttempt({
            // Every lane adapter names the lane it threw from; only an error
            // built without one is placed on the request's primary lane.
            lane: cur.lane ?? primaryServedLane(modelId, request),
            modelId,
            requestChars: requestChars(request),
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            providerCost: u.providerCost,
            creditsUsd: u.creditsUsd,
            estimated: cur instanceof LlmStreamAbortedError ? true : undefined,
          }))
        }
        return
      }
      const usage = (cur as { usage?: UsageWithAttempts } | null)?.usage
      if (usage && typeof usage === "object" && typeof usage.inputTokens === "number") {
        // A structured failure (`StructuredLlmError`, or a plugin's failed
        // `completeStructuredMetered` result): every attempt it made.
        if (Array.isArray(usage.attempts) && usage.attempts.length > 0) {
          this.#attempts.push(...(usage.attempts as Parameters<typeof checkedAttempt>[0][]).map((a) => checkedAttempt(a)))
          return
        }
        if (billed(usage)) {
          this.#attempts.push(checkedAttempt({
            lane: laneOf(cur) ?? primaryServedLane(modelId, request),
            modelId,
            requestChars: requestChars(request),
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            providerCost: usage.providerCost,
          }))
          return
        }
      }
      cur = (cur as { cause?: unknown }).cause
    }
  }

  /** Every attempt recorded, in order. */
  get attempts(): readonly LlmAttemptSpend[] {
    return this.#attempts
  }

  /** The provider cost of every attempt (USD). Throws `LlmRateMissingError` on a missing rate. */
  get costUsd(): number {
    return this.#attempts.reduce((sum, a) => sum + llmAttemptCostUsd(a), 0)
  }

  /** Whether any call reached the provider and was billed — false means refund. */
  get billedAnything(): boolean {
    return this.#attempts.length > 0
  }

  get record(): LlmBillingRecord {
    const costUsd = this.costUsd
    const order: readonly LlmBillingRecord["source"][] = ["abort-estimate", "kie-size-estimate", "provider-usage", "kie-stated"]
    const seen = new Set(this.#attempts.map(attemptSource))
    const source: LlmBillingRecord["source"] = costUsd < CREDIT_BASE_USD
      ? "floor"
      : order.find((s) => seen.has(s as AttemptSource)) ?? "provider-usage"
    return { costUsd, source, calls: this.#attempts.length, lanes: this.#attempts.map((a) => a.lane) }
  }
}

function laneOf(err: unknown): LlmServedLane | undefined {
  const lane = (err as { lane?: unknown }).lane
  if (lane === "kie" || lane === "direct-gemini" || lane === "direct-anthropic") return lane
  return undefined
}
