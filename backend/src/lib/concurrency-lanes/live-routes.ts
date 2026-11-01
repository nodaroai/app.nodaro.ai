// backend/src/lib/concurrency-lanes/live-routes.ts — what a live route tells
// its lane: the provider its LLM call will be served from, read off the raw
// body before validation (laneGuard's `provider`), and a stream's wait for its
// slot, told to the client as `metadata` events while it lasts.
//
// A stream opens before it can wait (its client is told where it stands), and
// it opens only after the route has reserved — so a stream that cannot get its
// slot ends through the route's own failure path: the job failed, the
// reservation refunded, an SSE `error` sent. acquireStreamLane answers that
// refusal instead of throwing it, so no route can forget it.
//
// With enforcement off every slot is granted at once: no wait, no event, no
// refusal.
import type { FastifyRequest } from "fastify"
import type { LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { markProviderCallStart } from "../reconcile/persistence.js"
import type { SSEController } from "../sse.js"
import { LANE_BUSY_MESSAGE, LaneBusyError, LaneWaitAbortedError, LaneWaitTimeoutError } from "./errors.js"
import type { LeafLane } from "./leaf-lanes.js"
import { primaryProviderOfLlm } from "./provider-of.js"
import { acquireLiveLane } from "./request-scope.js"

/**
 * The provider an LLM call of `modelId` at `reasoningEffort` would be served
 * from now; null when none would serve it. `advancedMode` pins the call to the
 * vendor's own API, as the routes' `resolveLlmParams` does.
 */
export function llmProviderOf(modelId: string, reasoningEffort?: string, advancedMode = false): string | null {
  return primaryProviderOfLlm({
    modelId,
    system: "",
    messages: [],
    ...(reasoningEffort ? { reasoningEffort: reasoningEffort as LlmReasoningEffort } : {}),
    ...(advancedMode ? { requireLane: "direct" as const, advancedMode: true } : {}),
  })
}

/** The raw (unvalidated) body of `req` as a record; empty for none. For laneGuard's `when` / `provider`. */
export function rawBodyOf(req: Pick<FastifyRequest, "body">): Record<string, unknown> {
  return req.body !== null && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {}
}

/** Whether `v` is a non-empty string — what a route's `!body.field` reads as present. */
export function isFilledText(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

const text = (v: unknown): string | undefined => (isFilledText(v) ? v : undefined)

/**
 * laneGuard's `provider` for an LLM route: the raw body's `llmModel` (else
 * `fallbackModel`, or what it reads off the body) at the body's
 * `reasoningEffort`, in Advanced mode when the body asks for it. Never throws.
 */
export function llmProviderOfBody(
  fallbackModel: string | ((body: Record<string, unknown>) => string | undefined),
): (req: Pick<FastifyRequest, "body">) => string | null {
  return (req) => {
    const body = rawBodyOf(req)
    const model = text(body.llmModel) ?? (typeof fallbackModel === "string" ? fallbackModel : fallbackModel(body))
    return model ? llmProviderOf(model, text(body.reasoningEffort), body.advancedMode === true) : null
  }
}

/** Why a stream did not get its slot: the SSE `error` it ends with, and the error itself for the route's failure path. */
export interface StreamLaneRefusal {
  code: string
  message: string
  error: Error
}

/**
 * Take a stream's live slot of `lane`, right after it opened (and after its
 * first `metadata` event, which names the job). While it waits, each check
 * sends a `metadata` event carrying `metadata` (the job id, so a client reading
 * the latest one keeps it) and `queue: { lane, position, waitedMs }`. Null once
 * it holds the slot (or runs under its caller's); a refusal when the wait ended
 * without one — past the live-wait limit, or its client left.
 *
 * `afterWait` runs once the slot is granted after a wait (never when it was
 * granted at once): a stream that stamped its provider call's start before it
 * waited stamps it again there (`restampProviderCallStart`), so the reconcile
 * sweep's clock, which runs from that stamp, never counts time spent in line.
 */
export async function acquireStreamLane(
  req: FastifyRequest,
  sse: SSEController,
  opts: { lane: LeafLane; provider: string | null; metadata: Record<string, unknown>; afterWait?: () => Promise<unknown> },
): Promise<StreamLaneRefusal | null> {
  let waited = false
  try {
    await acquireLiveLane(req, {
      lane: opts.lane,
      provider: opts.provider,
      onWaiting: (wait) => {
        waited = true
        sse.sendEvent({
          type: "metadata",
          data: { ...opts.metadata, queue: { lane: wait.lane, position: wait.position, waitedMs: wait.waitedMs } },
        })
      },
    })
  } catch (err) {
    if (err instanceof LaneBusyError) return { code: err.code, message: err.message, error: err }
    if (err instanceof LaneWaitTimeoutError) return { code: "lane_busy", message: err.message || LANE_BUSY_MESSAGE, error: err }
    if (err instanceof LaneWaitAbortedError) return { code: "client_closed_request", message: err.message, error: err }
    throw err
  }
  if (waited) await opts.afterWait?.()
  return null
}

/** A stream's `afterWait`: its synchronous LLM call starts now, not when it was first stamped. */
export function restampProviderCallStart(jobId: string): () => Promise<void> {
  return () => markProviderCallStart(jobId, "anthropic-sync")
}
