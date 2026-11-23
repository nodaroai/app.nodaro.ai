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
