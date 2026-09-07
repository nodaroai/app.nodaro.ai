import { supabase } from "../../lib/supabase.js"
import {
  Scene3DArtifactError,
  type Scene3DArtifactRecord,
  type Scene3DArtifactUsage,
  type Scene3DPinnedArtifact,
  type Scene3DRevisionRecord,
  type Scene3DUploadIntent,
} from "./types.js"

/**
 * Every database sentence this module speaks.
 *
 * Kept in one file so the route never touches the service-role client: these
 * tables are revoked from `authenticated` entirely, so authorization is all in
 * TypeScript and it belongs in `authorize.ts` rather than in handlers.
 *
 * The joins are two queries rather than one embed. The pin's foreign key is
 * composite, and an embed that stopped resolving would degrade into "no
 * assets" instead of an error.
 */

const REVISION_COLS =
  "id, user_id, workflow_id, source_job_id, parent_revision_id, plan, plan_sha256, created_at"
const ARTIFACT_COLS =
  "id, user_id, kind, bucket, object_key, sha256, byte_length, etag, expires_at, created_at"

type RevisionRow = {
  id: string
  user_id: string
  workflow_id: string | null
  source_job_id: string | null
  parent_revision_id: string | null
  plan: unknown
  plan_sha256: string
  created_at: string
}

type ArtifactRow = {
  id: string
  user_id: string
  kind: string
  bucket: string
  object_key: string
  sha256: string
  byte_length: number
  etag: string
  expires_at: string | null
  created_at: string
}

function toRevision(row: RevisionRow): Scene3DRevisionRecord {
  return {
    revisionId: row.id,
    userId: row.user_id,
    workflowId: row.workflow_id,
    sourceJobId: row.source_job_id,
    parentRevisionId: row.parent_revision_id,
    plan: row.plan,
    planSha256: row.plan_sha256,
    createdAt: row.created_at,
  }
}

function toArtifact(row: ArtifactRow): Scene3DArtifactRecord {
  return {
    artifactId: row.id,
    userId: row.user_id,
    kind: row.kind as Scene3DArtifactRecord["kind"],
    bucket: row.bucket,
    objectKey: row.object_key,
    sha256: row.sha256,
    byteLength: Number(row.byte_length),
    etag: row.etag,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

function storageFailure(context: string, error: unknown): Scene3DArtifactError {
  return new Scene3DArtifactError(
    "SCENE_STORAGE_FAILED",
    context,
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : undefined,
  )
}

export async function loadScene3DRevision(revisionId: string): Promise<Scene3DRevisionRecord | null> {
  const { data, error } = await supabase
    .from("scene3d_revisions")
    .select(REVISION_COLS)
    .eq("id", revisionId)
    .maybeSingle()
  if (error) throw storageFailure("reading the scene revision failed", error)
  return data ? toRevision(data as unknown as RevisionRow) : null
}

/** Every artifact THIS revision pins, with its usage. */
export async function loadScene3DRevisionArtifacts(
  revisionId: string,
): Promise<Scene3DPinnedArtifact[]> {
  const pins = await supabase
    .from("scene3d_revision_artifacts")
    .select("artifact_id, usage")
    .eq("revision_id", revisionId)
  if (pins.error) throw storageFailure("reading the scene revision assets failed", pins.error)

  const rows = (pins.data ?? []) as unknown as { artifact_id: string; usage: string }[]
  if (rows.length === 0) return []

  const artifacts = await supabase
    .from("scene3d_artifacts")
    .select(ARTIFACT_COLS)
    .in("id", rows.map((row) => row.artifact_id))
  if (artifacts.error) throw storageFailure("reading the scene assets failed", artifacts.error)

  const byId = new Map(
    ((artifacts.data ?? []) as unknown as ArtifactRow[]).map((row) => [row.id, toArtifact(row)]),
  )
  const pinned: Scene3DPinnedArtifact[] = []
  for (const row of rows) {
    const artifact = byId.get(row.artifact_id)
    // A pin whose artifact is gone cannot happen (the foreign key forbids it),
    // so this is not error recovery — it is refusing to invent an entry if it
    // ever does.
    if (artifact) pinned.push({ ...artifact, usage: row.usage as Scene3DArtifactUsage })
  }
  return pinned
}

/**
 * One artifact, but only as reached THROUGH the revision that pins it.
 *
 * The route's path carries the revision id for exactly this reason: an
 * artifact the caller owns but which this retained revision does not pin is
 * not readable here. Ownership alone is not the question — "does this exact
 * revision, the one the caller was authorized for, use these bytes" is.
 */
export async function loadScene3DPinnedArtifact(
  revisionId: string,
  artifactId: string,
  ownerId: string,
): Promise<Scene3DPinnedArtifact | null> {
  const pin = await supabase
    .from("scene3d_revision_artifacts")
    .select("artifact_id, usage")
    .eq("revision_id", revisionId)
    .eq("artifact_id", artifactId)
    .eq("user_id", ownerId)
    .maybeSingle()
  if (pin.error) throw storageFailure("reading the scene asset pin failed", pin.error)
  if (!pin.data) return null

  const artifact = await supabase
    .from("scene3d_artifacts")
    .select(ARTIFACT_COLS)
    .eq("id", artifactId)
    .eq("user_id", ownerId)
    .maybeSingle()
  if (artifact.error) throw storageFailure("reading the scene asset failed", artifact.error)
  if (!artifact.data) return null

  return {
    ...toArtifact(artifact.data as unknown as ArtifactRow),
    usage: (pin.data as unknown as { usage: string }).usage as Scene3DArtifactUsage,
  }
}

export async function loadScene3DArtifactsByIds(
  artifactIds: readonly string[],
): Promise<Scene3DArtifactRecord[]> {
  if (artifactIds.length === 0) return []
  const { data, error } = await supabase
    .from("scene3d_artifacts")
    .select(ARTIFACT_COLS)
    .in("id", [...artifactIds])
  if (error) throw storageFailure("reading scene assets failed", error)
  return ((data ?? []) as unknown as ArtifactRow[]).map(toArtifact)
}

const INTENT_COLS =
  "artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after, received_at, receipt_sha256, receipt_byte_length, receipt_etag"

type IntentRow = {
  artifact_id: string
  user_id: string
  job_id: string | null
  revision_id: string
  kind: string
  bucket: string
  object_key: string
  expires_at: string
  collect_after: string
  received_at: string | null
  receipt_sha256: string | null
  receipt_byte_length: number | null
  receipt_etag: string | null
}

function toIntent(row: IntentRow): Scene3DUploadIntent {
  return {
    artifactId: row.artifact_id,
    userId: row.user_id,
    jobId: row.job_id,
    revisionId: row.revision_id,
    kind: row.kind as Scene3DArtifactRecord["kind"],
    bucket: row.bucket,
    objectKey: row.object_key,
    expiresAt: row.expires_at,
    collectAfter: row.collect_after,
    receipt:
      row.receipt_sha256 && row.receipt_byte_length !== null && row.receipt_etag
        ? {
            sha256: row.receipt_sha256,
            byteLength: Number(row.receipt_byte_length),
            etag: row.receipt_etag,
            receivedAt: row.received_at,
          }
        : null,
  }
}

export async function loadScene3DUploadIntent(
  artifactId: string,
  userId: string,
): Promise<Scene3DUploadIntent | null> {
  const { data, error } = await supabase
    .from("scene3d_upload_intents")
    .select(INTENT_COLS)
    .eq("artifact_id", artifactId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw storageFailure("reading the upload reservation failed", error)
  return data ? toIntent(data as unknown as IntentRow) : null
}

export async function callScene3DReserveUpload(
  payload: Record<string, unknown>,
): Promise<Scene3DUploadIntent> {
  const { data, error } = await supabase.rpc("scene3d_reserve_upload", { payload })
  if (error) throw error
  if (!data) throw storageFailure("reserving the upload returned no reservation", null)
  return toIntent(data as unknown as IntentRow)
}

export async function callScene3DRecordUploadReceipt(
  payload: Record<string, unknown>,
): Promise<Scene3DUploadIntent> {
  const { data, error } = await supabase.rpc("scene3d_record_upload_receipt", { payload })
  if (error) throw error
  if (!data) throw storageFailure("recording the upload receipt returned no reservation", null)
  return toIntent(data as unknown as IntentRow)
}

export async function callScene3DSweepExpiredIntents(maxRows: number): Promise<number> {
  const { data, error } = await supabase.rpc("scene3d_sweep_expired_upload_intents", {
    max_rows: maxRows,
  })
  if (error) throw storageFailure("sweeping abandoned uploads failed", error)
  return typeof data === "number" ? data : 0
}

export async function callScene3DPublishRevision(payload: unknown): Promise<"created" | "unchanged"> {
  const { data, error } = await supabase.rpc("scene3d_publish_revision", { payload })
  if (error) throw error
  return data === "unchanged" ? "unchanged" : "created"
}

export async function callScene3DSweepExpired(maxRows: number): Promise<number> {
  const { data, error } = await supabase.rpc("scene3d_sweep_expired_artifacts", {
    max_rows: maxRows,
  })
  if (error) throw storageFailure("sweeping expired scene assets failed", error)
  return typeof data === "number" ? data : 0
}

export interface Scene3DGcTask {
  artifactId: string
  bucket: string
  objectKey: string
  attempts: number
}

export async function callScene3DClaimGc(
  maxRows: number,
  retryAfter: string,
): Promise<Scene3DGcTask[]> {
  const { data, error } = await supabase.rpc("scene3d_claim_artifact_gc", {
    max_rows: maxRows,
    retry_after: retryAfter,
  })
  if (error) throw storageFailure("claiming scene asset cleanup tasks failed", error)
  const rows = (data ?? []) as { artifact_id: string; bucket: string; object_key: string; attempts: number }[]
  return rows.map((row) => ({
    artifactId: row.artifact_id,
    bucket: row.bucket,
    objectKey: row.object_key,
    attempts: Number(row.attempts),
  }))
}

/** Marks the object deleted. The row stays as the artifact id's tombstone. */
export async function callScene3DCompleteGc(artifactId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("scene3d_complete_artifact_gc", {
    p_artifact_id: artifactId,
  })
  if (error) throw storageFailure("closing a scene asset cleanup task failed", error)
  return data === true
}
