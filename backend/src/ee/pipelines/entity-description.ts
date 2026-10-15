/**
 * Phase 3 (granular-pipeline-control spec) — Step A approval helpers.
 *
 * Used by `POST /v1/pipelines/:id/entities/:entityId/approve-description`
 * to handle the three modes the user can pick on the character wizard's
 * Step A panel:
 *
 *   - `mode='llm'`         — approve the LLM-derived description as-is →
 *                            flip entity `pending_description` → `pending`
 *                            so the engine generates the portrait.
 *   - `mode='user_edited'` — user rewrote the description; persist into
 *                            `metadata.visual_description`, then flip to
 *                            `pending`.
 *   - `mode='upload'`      — user uploaded their own portrait; create an
 *                            assets row + set `main_asset_id` + flip
 *                            directly to `approved`. NO image generation,
 *                            NO image critic by default (D2 override —
 *                            user owns the choice).
 *
 * Both helpers are idempotent via CAS on `status='pending_description'`:
 * a second click loses the race and returns
 * `{ ok: false, reason: 'entity_not_pending_description' }`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { EntityType } from "@nodaro/shared/pipeline"
import { pipelineEvents } from "./events.js"
import { judgeUrlForRecording } from "../../lib/key-ownership.js"

/** The client the ownership lookups read with (the caller's injected one). */
type OwnershipClient = Parameters<typeof judgeUrlForRecording>[2]

export type ApproveDescriptionFailReason =
  | "entity_not_found"
  | "entity_not_pending_description"
  | "asset_insert_failed"
  /** The url names an object of ours the caller cannot be shown to have made. */
  | "asset_not_owned"

export type ApproveDescriptionResult =
  | { ok: true; newStatus: "pending" | "approved"; assetId?: string }
  | { ok: false; reason: ApproveDescriptionFailReason; detail?: string }

interface BaseArgs {
  supabase: SupabaseClient
  pipelineId: string
  entityId: string
}

// ─── mode='llm' + mode='user_edited' ────────────────────────────────────────

export interface ApproveLlmOrEditedArgs extends BaseArgs {
  /**
   * Present only for mode='user_edited'. When defined, overwrites
   * `metadata.visual_description` before flipping status. When undefined
   * (mode='llm'), the existing description is used as-is.
   */
  newDescription?: string
}

/**
 * Flips a `pending_description` entity to `pending`, optionally overwriting
 * its visual_description. Engine's next drive cycle picks it up via the
 * existing `pending → generating → awaiting_approval` path.
 *
 * The route is responsible for enqueuing the pipeline run AFTER a
 * successful call; this helper just performs the DB transition + SSE.
 */
export async function approveDescriptionLlmOrEdited(
  args: ApproveLlmOrEditedArgs,
): Promise<ApproveDescriptionResult> {
  const { supabase, pipelineId, entityId, newDescription } = args

  const { data: entity } = await supabase
    .from("pipeline_entities")
    .select("id, entity_type, entity_key, status, metadata")
    .eq("id", entityId)
    .eq("pipeline_id", pipelineId)
    .maybeSingle()
  if (!entity) return { ok: false, reason: "entity_not_found" }
  if (entity.status !== "pending_description") {
    return { ok: false, reason: "entity_not_pending_description" }
  }

  // Build metadata. Only overwrite visual_description when explicitly
  // provided so mode='llm' is a pure status flip (no JSONB write churn).
  const existingMetadata = (entity.metadata ?? {}) as Record<string, unknown>
  const nextMetadata =
    newDescription !== undefined
      ? { ...existingMetadata, visual_description: newDescription }
      : existingMetadata

  const update: Record<string, unknown> = { status: "pending" }
  if (newDescription !== undefined) update.metadata = nextMetadata

  const { data: updated, error } = await supabase
    .from("pipeline_entities")
    .update(update)
    .eq("id", entityId)
    .eq("status", "pending_description")
    .select("id")
  if (error || !updated || updated.length === 0) {
    return { ok: false, reason: "entity_not_pending_description" }
  }

  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId,
    entityType: entity.entity_type as EntityType,
    entityKey: entity.entity_key as string,
    status: "pending",
  })

  return { ok: true, newStatus: "pending" }
}

// ─── mode='upload' ──────────────────────────────────────────────────────────

export interface AttachUploadedImageArgs extends BaseArgs {
  userId: string
  /** R2 URL from the prior /v1/upload/image call. */
  assetUrl: string
  /** Optional — derived from the URL path when omitted. */
  filename?: string
  /** Optional — guessed from the URL extension when omitted. */
  mimeType?: string
  /**
   * Accepted and not recorded (decided 2026-10-15): the row stores 0. The
   * upload's own row carries the size it was charged; a caller-sent figure
   * here would be refunded on delete as if it had been charged too.
   */
  sizeBytes?: number
  /**
   * D2 override — defaults to FALSE. Uploads bypass the image critic; the
   * user chose the image intentionally and the 3cr LLM opinion is unwanted.
   * Future callers (location uploads) can opt back in by passing `true`;
   * the critic invocation will be wired then.
   */
  runCritic?: boolean
}

/**
 * Creates an `assets` row from the user-uploaded R2 URL, points the entity
 * at it via `main_asset_id`, and flips the entity directly to `approved`
 * (skipping Step B per spec line 86). CAS-guarded on
 * `status='pending_description'`.
 */
export async function attachUploadedImageToEntity(
  args: AttachUploadedImageArgs,
): Promise<ApproveDescriptionResult> {
  const { supabase, pipelineId, entityId, userId, assetUrl } = args

  // runCritic is not yet wired — D2 override means uploads bypass critic in
  // Phase 3. Defensive throw if a future caller sets it without us having
  // implemented the path, so the bug is loud instead of silent.
  if (args.runCritic) {
    throw new Error(
      "[attachUploadedImageToEntity] runCritic=true is not wired in Phase 3 — see entity-description.ts D2 note before enabling for locations.",
    )
  }

  const { data: entity } = await supabase
    .from("pipeline_entities")
    .select("id, entity_type, entity_key, status")
    .eq("id", entityId)
    .eq("pipeline_id", pipelineId)
    .maybeSingle()
  if (!entity) return { ok: false, reason: "entity_not_found" }
  if (entity.status !== "pending_description") {
    return { ok: false, reason: "entity_not_pending_description" }
  }

  // Whose file (lib/key-ownership.ts; decided 2026-10-15). The image becomes
  // an `assets` row of the caller's, and a permanent delete of that row acts
  // on the object it names — so an object on OUR storage is recorded only
  // when the caller provably made it (their upload, their job's output, their
  // upload folder), under the one key it names. A url elsewhere is recorded as
  // its own key: it used to be the url's PATH, which could name any object of
  // ours whatever the host.
  const target = await judgeUrlForRecording(userId, assetUrl, supabase as unknown as OwnershipClient)
  if (target.kind === "refused") return { ok: false, reason: "asset_not_owned" }
  const r2Key = target.kind === "owned" ? target.key : assetUrl
  const r2Url = target.kind === "owned" ? target.url : assetUrl
  const filename = args.filename ?? extractFilename(r2Url)
  const mimeType = args.mimeType ?? guessMimeFromUrl(r2Url)

  // Mirror the canonical asset insert shape from workers/shared.ts (line
  // ~534) — same fields, `upload_source: "manual_upload"` (matches the
  // existing /v1/upload/image flow's source tag). The size is not recorded:
  // this row points at an object the upload's own row already charged, and a
  // size the caller sends would be refunded as if it had been charged twice.
  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .insert({
      user_id: userId,
      type: "image",
      r2_key: r2Key,
      r2_url: r2Url,
      filename,
      mime_type: mimeType,
      size_bytes: 0,
      upload_source: "manual_upload",
      pipeline_id: pipelineId,
      pipeline_entity_id: entityId,
    })
    .select("id")
    .single()
  if (assetErr || !asset) {
    return {
      ok: false,
      reason: "asset_insert_failed",
      detail: assetErr?.message,
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from("pipeline_entities")
    .update({
      status: "approved",
      main_asset_id: asset.id,
    })
    .eq("id", entityId)
    .eq("status", "pending_description")
    .select("id")
  if (updateErr || !updated || updated.length === 0) {
    return { ok: false, reason: "entity_not_pending_description" }
  }

  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId,
    entityType: entity.entity_type as EntityType,
    entityKey: entity.entity_key as string,
    status: "approved",
    mainAssetUrl: r2Url,
  })

  return { ok: true, newStatus: "approved", assetId: asset.id as string }
}

// ─── skip ───────────────────────────────────────────────────────────────────

export type SkipEntityResult =
  | { ok: true }
  | {
      ok: false
      reason: "entity_not_found" | "entity_not_pending_description"
    }

/**
 * Phase 3 — Step A skip action. Flips a `pending_description` entity to
 * terminal `skipped` state. No image generated, no critic, no asset row.
 * CAS-guarded; concurrent re-click returns `entity_not_pending_description`.
 *
 * The frontend wizard surfaces a one-line warning at skip time when the
 * character appears in `plan.scenes[].cast_keys` (D3 override) — that check
 * is purely UI-side. The backend route does NOT block based on scene refs;
 * downstream stages handle missing main_asset_id their own way.
 */
export async function skipEntity(args: BaseArgs): Promise<SkipEntityResult> {
  const { supabase, pipelineId, entityId } = args

  const { data: entity } = await supabase
    .from("pipeline_entities")
    .select("id, entity_type, entity_key, status")
    .eq("id", entityId)
    .eq("pipeline_id", pipelineId)
    .maybeSingle()
  if (!entity) return { ok: false, reason: "entity_not_found" }
  if (entity.status !== "pending_description") {
    return { ok: false, reason: "entity_not_pending_description" }
  }

  const { data: updated, error } = await supabase
    .from("pipeline_entities")
    .update({ status: "skipped" })
    .eq("id", entityId)
    .eq("status", "pending_description")
    .select("id")
  if (error || !updated || updated.length === 0) {
    return { ok: false, reason: "entity_not_pending_description" }
  }

  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId,
    entityType: entity.entity_type as EntityType,
    entityKey: entity.entity_key as string,
    status: "skipped",
  })

  return { ok: true }
}

// ─── URL helpers ────────────────────────────────────────────────────────────

function extractFilename(url: string): string {
  try {
    const u = new URL(url)
    const segments = u.pathname.split("/")
    return segments[segments.length - 1] || "upload"
  } catch {
    return "upload"
  }
}

function guessMimeFromUrl(url: string): string {
  const lower = url.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".avif")) return "image/avif"
  // Default to JPEG — covers .jpg/.jpeg, the most common photo upload type
  // (and the /v1/upload/image route's HEIC fallback also outputs JPEG).
  return "image/jpeg"
}
