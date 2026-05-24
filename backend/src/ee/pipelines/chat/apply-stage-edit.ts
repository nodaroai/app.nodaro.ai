/**
 * Phase 1D.2b D1 — applyStageEdit unified helper.
 *
 * Single source of truth for the stage-advance transition triggered by EITHER
 * (a) `POST /v1/pipelines/:id/stages/:stage/chat/turns/:turnId/apply` (the
 * chat_apply route) OR (b) the existing approveScriptStage path with a user
 * edit payload (approve_edits source). Both routes funnel through this
 * helper so the validation + audit-trail + CAS semantics are identical.
 *
 * Sequential algorithm (per design spec §5.1):
 *   1. Look up stage row by stageId; reject if status !== 'awaiting_approval'.
 *   2. Look up STAGE_PATCH_SCHEMA[stageName]; reject if null (non-patchable).
 *   3. Validate patch shape with fast-json-patch's `validate()`.
 *   4. Load the most recent pipeline_stage_attempts row for `output`
 *      (falls back to pipeline_stages.output when no attempt rows yet).
 *   5. Deep-clone + apply patch via `applyPatch(doc, ops, false, false)`.
 *   6. Validate result against STAGE_PATCH_SCHEMA[stageName] (Zod).
 *   7. Script-only: run checkReferenceIntegrity(before, after) to block
 *      cast/locations/objects removals that still have residual refs.
 *   8. Compute attempt_n = max(existing) + 1.
 *   9. INSERT new pipeline_stage_attempts row (trigger mapped from source).
 *  10. UPDATE chat turn's applied_to_attempt_id (if chatTurnId provided).
 *  11. CAS UPDATE pipeline_stages SET status='approved' WHERE id=? AND
 *      status='awaiting_approval'; if 0 rows returned → race lost → reject
 *      with stage_not_awaiting (the audit-trail attempt row is left in place
 *      — design choice per plan, distinguishes "tried but lost" from "never
 *      tried"). Concurrent approval already enqueued the next stage; we MUST
 *      NOT double-fire enqueue or SSE.
 *  12. enqueuePipelineRun({reason:'stage_advance'}) + publish SSE
 *      `chat:proposal_applied`.
 *
 * Routes call this helper and surface its result; they MUST NOT independently
 * enqueue or fire SSE for the apply-success path.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
// fast-json-patch ships as CJS (main: index.js). Node's lexer detects its
// named exports, but tsx/esbuild's ESM loader does not — a named import
// (`import { applyPatch } from ...`) throws "no export named applyPatch" under
// tsx. Default-import the module object + destructure, which works under both.
import jsonpatch from "fast-json-patch"
const { applyPatch, validate: validatePatch } = jsonpatch
import type {
  JsonPatch,
  PipelineStageName,
  ShowrunnerPlan,
} from "@nodaro/shared"
import { STAGE_PATCH_SCHEMA } from "@nodaro/shared"
import { pipelineEvents } from "../events.js"
import { checkReferenceIntegrity } from "./reference-integrity.js"

/**
 * Storage envelope shape per stage. The engine writes Stage 1 output as
 * `{plan: ShowrunnerPlan}` (see engine.ts:301), but STAGE_PATCH_SCHEMA
 * validates the bare ShowrunnerPlan. This map handles the unwrap/rewrap
 * so the helper reads + validates + writes consistently.
 *
 * `null` = no envelope (bare value). Add entries for shot_list / post_merge
 * when 1D.2d enables their chat surfaces.
 */
const STAGE_ENVELOPE_KEY: Record<PipelineStageName, string | null> = {
  script: "plan",
  characters: null,
  objects: null,
  locations: null,
  shot_list: null,
  scene_images: null,
  animate_audio_edit: null,
  post_merge: null,
}

export type ApplyStageEditSource =
  | "chat_apply"
  | "approve_edits"
  | "engine_chat_apply"

export interface ApplyStageEditArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageName: PipelineStageName
  stageId: string
  userId: string
  jsonPatch: JsonPatch
  source: ApplyStageEditSource
  llmCallId?: string
  chatTurnId?: string
}

export type ApplyStageEditResult =
  | { ok: true; newAttemptId: string; newOutput: unknown }
  | {
      ok: false
      reason:
        | "stage_not_awaiting"
        | "patch_invalid"
        | "schema_invalid"
        | "reference_integrity_failed"
      detail?: unknown
    }

/** Map ApplyStageEditSource → pipeline_stage_attempts.trigger CHECK value. */
function triggerForSource(source: ApplyStageEditSource): string {
  if (source === "approve_edits") return "user_edit"
  // chat_apply and engine_chat_apply both record as chat_refine — the CHECK
  // constraint on pipeline_stage_attempts.trigger admits 'chat_refine' but
  // NOT 'engine_chat_apply'. We collapse the two chat-driven sources so the
  // DB sees a single canonical value.
  return "chat_refine"
}

export async function applyStageEdit(
  args: ApplyStageEditArgs,
): Promise<ApplyStageEditResult> {
  const {
    supabase,
    pipelineId,
    stageName,
    stageId,
    userId,
    jsonPatch,
    source,
    chatTurnId,
  } = args

  // 1. Look up the stage row by stageId; reject if not awaiting_approval.
  const { data: stageRow, error: stageErr } = await supabase
    .from("pipeline_stages")
    .select("id, status, stage_name, output")
    .eq("id", stageId)
    .single()
  if (stageErr || !stageRow) {
    return { ok: false, reason: "stage_not_awaiting" }
  }
  if (stageRow.status !== "awaiting_approval") {
    return { ok: false, reason: "stage_not_awaiting" }
  }

  // 2. Look up the per-stage Zod schema. Null = chat not enabled for this stage.
  const stageSchema = STAGE_PATCH_SCHEMA[stageName]
  if (!stageSchema) {
    return {
      ok: false,
      reason: "patch_invalid",
      detail: { stage_not_patchable: true, stage: stageName },
    }
  }

  // 4 (before 3): load the current artifact. Latest attempt's output wins;
  // fallback to pipeline_stages.output when no attempts exist yet (e.g. very
  // early dev fixtures or stages whose handler writes only to pipeline_stages).
  const { data: latestAttempt } = await supabase
    .from("pipeline_stage_attempts")
    .select("id, attempt_n, output")
    .eq("pipeline_stage_id", stageId)
    .order("attempt_n", { ascending: false })
    .limit(1)
    .maybeSingle()

  // The engine writes some stage outputs wrapped in an envelope object (Stage
  // 1 = `{plan: ShowrunnerPlan}`), while STAGE_PATCH_SCHEMA validates the
  // bare doc. Unwrap before validating + patching, then rewrap on write.
  const rawCurrent =
    (latestAttempt?.output as Record<string, unknown> | undefined) ??
    (stageRow.output as Record<string, unknown> | undefined) ??
    {}
  const envKey = STAGE_ENVELOPE_KEY[stageName]
  const currentDoc = envKey
    ? ((rawCurrent[envKey] as Record<string, unknown> | undefined) ?? {})
    : rawCurrent

  // 3. Validate patch shape against the BARE document.
  const validateErr = validatePatch(jsonPatch, currentDoc)
  if (validateErr) {
    return { ok: false, reason: "patch_invalid", detail: validateErr }
  }

  // 5. Apply the patch immutably. `validate=false` (we already validated),
  // `mutate=false` (don't touch caller's reference). Deep clone to be safe
  // even if fast-json-patch's immutable mode silently mutates nested refs.
  let newDocument: unknown
  try {
    const cloned = JSON.parse(JSON.stringify(currentDoc))
    const applied = applyPatch(cloned, jsonPatch, false, false)
    newDocument = applied.newDocument
  } catch (err) {
    return {
      ok: false,
      reason: "patch_invalid",
      detail: { message: err instanceof Error ? err.message : String(err) },
    }
  }

  // 6. Re-validate the post-patch BARE document against the per-stage Zod schema.
  const zodResult = stageSchema.safeParse(newDocument)
  if (!zodResult.success) {
    return {
      ok: false,
      reason: "schema_invalid",
      detail: zodResult.error.issues,
    }
  }

  // 7. Reference integrity (script only — only ShowrunnerPlan has cast/loc/obj refs).
  if (stageName === "script") {
    const integrity = checkReferenceIntegrity(
      currentDoc as unknown as ShowrunnerPlan,
      zodResult.data as ShowrunnerPlan,
    )
    if (!integrity.ok) {
      return {
        ok: false,
        reason: "reference_integrity_failed",
        detail: integrity,
      }
    }
  }

  // 8. Compute next attempt_n.
  const nextAttemptN = (latestAttempt?.attempt_n ?? 0) + 1

  // Rewrap the patched bare doc back into the storage envelope if this stage
  // uses one. This goes into BOTH pipeline_stage_attempts.output (audit row)
  // AND pipeline_stages.output (so downstream stages — e.g. characters.ts:63
  // reading `(scriptStage?.output as { plan?: ShowrunnerPlan })?.plan` — see
  // the patched plan instead of the pre-patch version).
  const finalDoc = envKey
    ? ({ [envKey]: zodResult.data } as Record<string, unknown>)
    : (zodResult.data as unknown as Record<string, unknown>)

  // 9. INSERT new attempt row. We do this BEFORE the CAS flip on purpose —
  // if the CAS loses the race, the audit-trail row stays as a record that
  // a refine was attempted (and tells future debugging which patch produced
  // which post-image). The non-current attempt has no `applied_to_attempt_id`
  // link from any chat turn, so nothing else references it.
  const trigger = triggerForSource(source)
  const { data: insertedAttempt, error: insertErr } = await supabase
    .from("pipeline_stage_attempts")
    .insert({
      pipeline_stage_id: stageId,
      attempt_n: nextAttemptN,
      trigger,
      output: finalDoc,
    })
    .select("id")
    .single()
  if (insertErr || !insertedAttempt) {
    // INSERT failure is exceptional — surface as patch_invalid with a marker
    // so the caller can log/observe. Realistically this only happens on
    // UNIQUE-key collisions if two concurrent applies got the same attempt_n.
    return {
      ok: false,
      reason: "patch_invalid",
      detail: { insert_failed: true, message: insertErr?.message ?? "no row" },
    }
  }
  const newAttemptId = insertedAttempt.id

  // 10. UPDATE the source chat turn's applied_to_attempt_id when given.
  if (chatTurnId) {
    await supabase
      .from("pipeline_chat_turns")
      .update({ applied_to_attempt_id: newAttemptId })
      .eq("id", chatTurnId)
  }

  // 11. CAS UPDATE pipeline_stages — only flip from awaiting_approval to
  // approved AND write the patched output so downstream stages see the
  // post-refine doc (downstream handlers read pipeline_stages.output, NOT
  // the latest attempt row). If 0 rows match (someone else already approved),
  // return stage_not_awaiting without enqueuing or publishing SSE.
  const { data: casRows, error: casErr } = await supabase
    .from("pipeline_stages")
    .update({
      status: "approved",
      output: finalDoc,
      completed_at: new Date().toISOString(),
    })
    .eq("id", stageId)
    .eq("status", "awaiting_approval")
    .select("id")
  if (casErr) {
    // Optimistically surface as stage_not_awaiting; we already wrote an audit row.
    return { ok: false, reason: "stage_not_awaiting" }
  }
  if (!casRows || casRows.length === 0) {
    return { ok: false, reason: "stage_not_awaiting" }
  }

  // 12. Enqueue the next stage drive + publish chat:proposal_applied SSE.
  // Lazy import to avoid pulling BullMQ / ioredis into modules that may be
  // imported in pure-logic contexts (tests, MCP tool handlers, etc.).
  const { enqueuePipelineRun } = await import("../queue.js")
  await enqueuePipelineRun({
    pipelineId,
    userId,
    reason: "stage_advance",
  })

  if (chatTurnId) {
    pipelineEvents.publish({
      type: "chat:proposal_applied",
      pipelineId,
      stageName,
      turnId: chatTurnId,
      attemptId: newAttemptId,
    })
  }

  return { ok: true, newAttemptId, newOutput: zodResult.data }
}
