// @reads-none asks the database whether two objects exist; reads no repo file
/**
 * The R33 probe (`./llm-metered-schema-gate.ts`): are migration 551's
 * `commit_credits_metered`, migration 552's `jobs.llm_billing` and migration
 * 554's `reserve_llm_side_hold` all in this database? Service role,
 * side-effect free:
 *
 *  - the RPC is called with a negative actual, which the function refuses
 *    FIRST (`METERED_ACTUAL_REQUIRED`, before any row is read or locked), so
 *    that refusal proves it exists; a missing function answers PostgREST's
 *    PGRST202 / Postgres 42883;
 *  - the column is selected on zero rows; a missing column answers
 *    42703 / PGRST204.
 *
 * Any other answer — a network error, a timeout, a different error — is NOT a
 * yes: the gate stays on the earlier tier path and asks again later.
 *
 * A LEAF module: it is handed the service-role client (the gate gets it from
 * `./supabase.ts`, which registers it at creation) instead of importing it, so
 * config.ts → the gate → this probe never loops back through the client's
 * own import of config.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

/** The `jobs` column the metered billing ledger lives in (migration 552). Re-exported by `./llm-billing-ledger.ts`. */
export const LLM_BILLING_LEDGER_COLUMN = "llm_billing"

/** The slice of the service-role client the probe uses. */
export type LlmMeteredSchemaProbeClient = Pick<SupabaseClient, "rpc" | "from">

const PROBE_LOG_ID = "00000000-0000-0000-0000-000000000000"

async function meteredCommitExists(db: LlmMeteredSchemaProbeClient): Promise<boolean> {
  // billing-payer-ok: an existence probe — the negative actual is refused before any usage_logs row is read, so no payer is charged, refunded or looked up
  const { error } = await db.rpc("commit_credits_metered", { p_usage_log_id: PROBE_LOG_ID, p_actual_credits: -1 })
  // The function exists and refused the probe's actual, as designed.
  return error !== null && /METERED_ACTUAL_REQUIRED/.test(error.message ?? "")
}

/**
 * 554's `reserve_llm_side_hold` (metered LLM side holds): called with a
 * negative credit amount, which it refuses FIRST (`SIDE_HOLD_INVALID`, before
 * any row is read or locked) — nothing is reserved. Side holds ship with
 * metered pricing, so metered pricing waits for them too.
 */
async function sideHoldReserveExists(db: LlmMeteredSchemaProbeClient): Promise<boolean> {
  // billing-payer-ok: an existence probe — the negative amount is refused before any job, profile or usage log is read, so no payer is charged or looked up
  const { error } = await db.rpc("reserve_llm_side_hold", { p_user_id: PROBE_LOG_ID, p_credits: -1, p_job_id: PROBE_LOG_ID, p_charge_id: "" })
  return error !== null && /SIDE_HOLD_INVALID/.test(error.message ?? "")
}

async function ledgerColumnExists(db: LlmMeteredSchemaProbeClient): Promise<boolean> {
  const { error } = await db.from("jobs").select(LLM_BILLING_LEDGER_COLUMN).limit(0)
  return error === null
}

export async function probeLlmMeteredSchema(db: LlmMeteredSchemaProbeClient): Promise<boolean> {
  const [commit, column, side] = await Promise.all([meteredCommitExists(db), ledgerColumnExists(db), sideHoldReserveExists(db)])
  if (!commit || !column || !side) {
    console.warn(
      `[llm-billing] metered LLM schema not ready (commit_credits_metered: ${commit}, jobs.llm_billing: ${column}, reserve_llm_side_hold: ${side}) — tier pricing until it is`,
    )
  }
  return commit && column && side
}
