import type { FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { hasCredits } from "./config.js"
import { trustedPluginParentJobId } from "./job-submission-context.js"
import { isPluginJobType } from "./concurrency-lanes/registry.js"

/**
 * The request side of a deferred child settlement (the settlement itself is
 * lib/deferred-child-settlement.ts). Kept light on purpose: /v1/generate-video
 * imports it, and the hot route must not pull the settlement's billing graph
 * (`workers/shared.ts`) into its own.
 */

/** The server-only `input_data` key that asks for the deferral (a top-level `__` key no job read returns). */
export const DEFER_SETTLEMENT_INPUT_KEY = "__deferSettlement"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Whether a stored job asked for (and was granted) a deferred settlement. */
export function storedDeferSettlement(inputData: unknown): boolean {
  return isRecord(inputData) && inputData[DEFER_SETTLEMENT_INPUT_KEY] === true
}

/**
 * HOW a held child is decided when its plugin did not decide it, set by the
 * ROUTE that admitted it (never by a caller), server-only beside
 * `__deferSettlement`:
 *  - absent: an engine take — a completed run keeps ONE take charged
 *    (`planCompletedRun`, deferred-child-settlement-sweep.ts);
 *  - `"delivered"`: a step whose file the run may or may not deliver (Video
 *    Remake's upscale, /v1/video-upscale) — charged only when its run
 *    completed AND its output names the child among the files it delivered
 *    (`DELIVERED_HELD_CHILDREN_OUTPUT_KEY`). It is never pooled with the engine
 *    takes, in either direction.
 */
export const DEFER_SETTLEMENT_RULE_INPUT_KEY = "__deferSettlementRule"

export type DeferSettlementRule = "delivered"

/** A stored job's rule, or null (an engine take, or a job that was not deferred). */
export function storedDeferRule(inputData: unknown): DeferSettlementRule | null {
  return isRecord(inputData) && inputData[DEFER_SETTLEMENT_RULE_INPUT_KEY] === "delivered" ? "delivered" : null
}

/**
 * The server-only key of a PARENT's `output_data` naming the `"delivered"`
 * children whose files its completion delivered (a string array; `[]` when it
 * delivered none). Written by the plugin in the same completion as the
 * delivery, so it is the truth a crash between the delivery and the plugin's
 * own settle cannot lose.
 */
export const DELIVERED_HELD_CHILDREN_OUTPUT_KEY = "__deliveredHeldChildren"

/**
 * The `/v1/video-upscale` providers whose job may be held under the
 * `"delivered"` rule: the two a Video Remake run's upscale step runs on. Both
 * complete through `finalizeJobWithMedia` (their worker lanes and their
 * reconciles; deferred-child-completion-lanes.test.ts holds it).
 */
export const DEFERRABLE_UPSCALE_PROVIDERS: ReadonlySet<string> = new Set(["topaz", "topaz-rhea"])

/**
 * Whether THIS /v1/generate-video request may defer its job's settlement:
 * credits are on, the request is the plugin toolkit's own worker request with
 * a parent (`trustedPluginParentJobId` — never a header or a body field), and
 * that parent is a job of the caller's own whose type a loaded private plugin
 * handles. Anything else (a public caller sending the field included) → false,
 * and the field is ignored.
 */
export async function deferSettlementHonoured(req: FastifyRequest): Promise<boolean> {
  if (!hasCredits()) return false
  const parentJobId = trustedPluginParentJobId(req)
  if (parentJobId === undefined || !req.userId) return false
  try {
    // trash-read: the running job whose own handler sent this request.
    const { data, error } = await supabase
      .from("jobs")
      .select("user_id, job_type, input_data")
      .eq("id", parentJobId)
      .eq("user_id", req.userId)
      .maybeSingle()
    if (error || !data) return false
    const row = data as { user_id?: unknown; job_type?: unknown; input_data?: unknown }
    if (row.user_id !== req.userId) return false
    const stored = isRecord(row.input_data) ? row.input_data.type : undefined
    const type = typeof row.job_type === "string" && row.job_type !== "" ? row.job_type : stored
    return typeof type === "string" && isPluginJobType(type)
  } catch {
    return false
  }
}
