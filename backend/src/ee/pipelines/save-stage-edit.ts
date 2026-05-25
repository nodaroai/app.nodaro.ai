/**
 * Phase 1 (granular-pipeline-control spec) — `saveStageEdit` helper for
 * inline scene edits that DO NOT advance the stage.
 *
 * Sibling to `chat/apply-stage-edit.ts` but with different semantics:
 *   - applyStageEdit: validate + apply + insert audit attempt row +
 *     CAS-flip status='approved' + enqueue stage_advance + emit SSE.
 *     Used by chat-apply + approve-with-edits — always advances.
 *   - saveStageEdit: validate + apply + write back to pipeline_stages.output
 *     + APPEND the patch ops to pipeline_stages.user_edits (audit trail).
 *     Does NOT change status, does NOT enqueue, does NOT emit SSE.
 *
 * Phase 1 restriction: script stage only, four editable scene fields
 * (description, duration_seconds, emotional_beat, dialogue[m].line). Anything
 * else is rejected upfront with `patch_path_not_editable`. Add/delete scene
 * + roster + continuity edits are deferred (spec lines 39–48, 211–217).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
// fast-json-patch ships as CJS — see chat/apply-stage-edit.ts for the
// default-import-then-destructure rationale (named imports fail under tsx).
import jsonpatch from "fast-json-patch"
const { applyPatch, validate: validatePatch } = jsonpatch
import type {
  JsonPatch,
  PipelineStageName,
  ShowrunnerPlan,
} from "@nodaro/shared"
import { STAGE_PATCH_SCHEMA } from "@nodaro/shared"
import { checkReferenceIntegrity } from "./chat/reference-integrity.js"
import { STAGE_ENVELOPE_KEY } from "./chat/apply-stage-edit.js"

export interface SaveStageEditArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  stageName: PipelineStageName
  userId: string
  jsonPatch: JsonPatch
}

export type SaveStageEditResult =
  | { ok: true; newOutput: unknown }
  | {
      ok: false
      reason:
        | "stage_not_awaiting"
        | "stage_not_editable"
        | "patch_path_not_editable"
        | "patch_invalid"
        | "schema_invalid"
        | "reference_integrity_failed"
      detail?: unknown
    }

/**
 * Phase 1 path whitelist for script stage. Strict — every patch op's path
 * must match one of these four patterns. The spec's user-facing names
 * ("action", "dialogue_line") map to the actual SceneSpecSchema field names
 * (`description`, `dialogue[m].line`) — the UI surfaces the friendly labels
 * while the patch paths stay schema-true.
 */
const SCRIPT_EDITABLE_PATH_PATTERNS: ReadonlyArray<RegExp> = [
  /^\/scenes\/\d+\/description$/,
  /^\/scenes\/\d+\/duration_seconds$/,
  /^\/scenes\/\d+\/emotional_beat$/,
  /^\/scenes\/\d+\/dialogue\/\d+\/line$/,
]

function isEditablePath(stageName: PipelineStageName, path: string): boolean {
  if (stageName !== "script") return false
  return SCRIPT_EDITABLE_PATH_PATTERNS.some((re) => re.test(path))
}

export async function saveStageEdit(
  args: SaveStageEditArgs,
): Promise<SaveStageEditResult> {
  const { supabase, stageId, stageName, jsonPatch } = args

  // 1. Phase 1 scope gate — only the script stage has editable paths defined.
  if (stageName !== "script") {
    return { ok: false, reason: "stage_not_editable" }
  }

  // 2. Path + op whitelist — reject upfront before any DB roundtrip. Only
  // `replace` ops on the four whitelisted paths are accepted. add/remove
  // are deferred (add-scene/delete-scene = Phase 5; dialogue add/remove
  // also deferred). Reject the whole batch on first offender so the caller
  // fix-and-retries without partial application.
  for (const op of jsonPatch) {
    if (op.op !== "replace") {
      return {
        ok: false,
        reason: "patch_path_not_editable",
        detail: { offending_op: op.op, offending_path: op.path },
      }
    }
    if (!isEditablePath(stageName, op.path)) {
      return {
        ok: false,
        reason: "patch_path_not_editable",
        detail: { offending_path: op.path },
      }
    }
  }

  // 3. Load stage row + verify awaiting_approval.
  const { data: stageRow, error: stageErr } = await supabase
    .from("pipeline_stages")
    .select("id, status, stage_name, output, user_edits")
    .eq("id", stageId)
    .single()
  if (stageErr || !stageRow) {
    return { ok: false, reason: "stage_not_awaiting" }
  }
  if (stageRow.status !== "awaiting_approval") {
    return { ok: false, reason: "stage_not_awaiting" }
  }

  // 4. Per-stage Zod schema must exist (script is wired in 1D.2b).
  const stageSchema = STAGE_PATCH_SCHEMA[stageName]
  if (!stageSchema) {
    return { ok: false, reason: "stage_not_editable" }
  }

  // 5. Unwrap the storage envelope. Stage 1 wraps as `{plan: ShowrunnerPlan}`;
  // STAGE_PATCH_SCHEMA validates the bare ShowrunnerPlan.
  const rawCurrent =
    (stageRow.output as Record<string, unknown> | undefined) ?? {}
  const envKey = STAGE_ENVELOPE_KEY[stageName]
  const currentDoc = envKey
    ? ((rawCurrent[envKey] as Record<string, unknown> | undefined) ?? {})
    : rawCurrent

  // 6. Validate patch shape against the BARE doc.
  const validateErr = validatePatch(jsonPatch, currentDoc)
  if (validateErr) {
    return { ok: false, reason: "patch_invalid", detail: validateErr }
  }

  // 7. Apply patch immutably. validate=false (already validated above),
  // mutate=false (don't touch caller's reference). Deep-clone-first protects
  // against fast-json-patch's nested-ref handling in immutable mode.
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

  // 8. Zod re-validate the post-patch bare doc.
  const zodResult = stageSchema.safeParse(newDocument)
  if (!zodResult.success) {
    return {
      ok: false,
      reason: "schema_invalid",
      detail: zodResult.error.issues,
    }
  }

  // 9. Reference integrity (script only). The whitelist forbids cast/loc/obj
  // removals so this is defensive — guards against future whitelist additions
  // accidentally breaking referential integrity.
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

  // 10. Rewrap into the storage envelope + append patch ops to user_edits
  // (spec § "Persistence model" — accumulating audit trail; future undo
  // surface per spec open question #2). `user_edits` may be NULL (column is
  // nullable, no default); coalesce to [].
  const rewrapped = envKey
    ? ({ [envKey]: zodResult.data } as Record<string, unknown>)
    : (zodResult.data as unknown as Record<string, unknown>)
  const existingEdits = Array.isArray(stageRow.user_edits)
    ? (stageRow.user_edits as unknown[])
    : []
  const mergedEdits = [...existingEdits, ...jsonPatch]

  // CAS-guard on status — protect against a concurrent approve flipping the
  // row out from under us between our SELECT and UPDATE. .select("id") so we
  // can count affected rows.
  const { data: updatedRows, error: updateErr } = await supabase
    .from("pipeline_stages")
    .update({
      output: rewrapped,
      user_edits: mergedEdits,
    })
    .eq("id", stageId)
    .eq("status", "awaiting_approval")
    .select("id")
  if (updateErr) {
    return {
      ok: false,
      reason: "patch_invalid",
      detail: { message: updateErr.message },
    }
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, reason: "stage_not_awaiting" }
  }

  return { ok: true, newOutput: zodResult.data }
}
