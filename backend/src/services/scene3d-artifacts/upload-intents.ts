import { callScene3DRecordUploadReceipt, callScene3DReserveUpload, loadScene3DUploadIntent } from "./db.js"
import { scene3DArtifactObjectKey, isScene3DId } from "./object-keys.js"
import { inspectScene3DObject } from "./receipt.js"
import { translateScene3DSqlError } from "./sql-errors.js"
import type { Scene3DObjectStore } from "./object-store.js"
import {
  SCENE3D_ARTIFACT_KIND_USAGE,
  Scene3DArtifactError,
  type Scene3DArtifactKind,
  type Scene3DUploadIntent,
  type Scene3DUploadReceipt,
} from "./types.js"

/**
 * Reservations: the durable record of an upload that has been permitted.
 *
 * A build writes its output before it publishes anything, and many builds never
 * publish — they fail, they are cancelled, the process dies. Without a row
 * written BEFORE the capability is issued, those bytes are objects the database
 * has never heard of, and nothing can decide to delete them.
 *
 * The order is: reserve, grant, upload, receive, publish. Every step that
 * touches a reservation is one SQL function holding that row's lock, because
 * the interesting failures are all orderings — an expiry sweep landing between
 * a grant and its retry, or a cleanup worker holding a claim while a new grant
 * is minted for the same key. An artifact id that cleanup has ever heard of is
 * retired permanently; a retry gets a new id, never a revived one.
 */

/** How long an upload capability lasts, unless the caller says otherwise. */
export const SCENE3D_UPLOAD_TTL_SECONDS = 900
/**
 * How long after expiry the bytes are left alone.
 *
 * Not politeness: an upload that finished a second before its grant expired may
 * still be on its way to publication, and deleting it out from under that turns
 * a slow build into a corrupt one.
 */
export const SCENE3D_UPLOAD_GRACE_SECONDS = 3600

export interface Scene3DUploadReservation {
  artifactId: string
  userId: string
  revisionId: string
  kind: Scene3DArtifactKind
  jobId?: string | null
  ttlSeconds?: number
  graceSeconds?: number
}

function invalid(message: string, detail?: string): never {
  throw new Scene3DArtifactError("SCENE_ASSET_INVALID", message, detail)
}

function seconds(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 60 || value > max) {
    invalid(`an upload window of ${value} seconds is out of range`)
  }
  return value
}

/**
 * Reserve the exact bytes a build may write, and return where they go.
 *
 * Re-reserving the same artifact under the same scope extends the window, so a
 * retried grant cannot be swept while it uploads. A different job, owner,
 * revision, kind or key is a conflict — an id is not a slot to be reused — and
 * an id cleanup has already seen is refused outright.
 */
export async function reserveScene3DUploadIntent(
  store: Scene3DObjectStore,
  input: Scene3DUploadReservation,
): Promise<Scene3DUploadIntent> {
  if (!isScene3DId(input.artifactId)) invalid("artifactId must be a UUID")
  if (!SCENE3D_ARTIFACT_KIND_USAGE[input.kind]) invalid(`unknown artifact kind "${input.kind}"`)

  const objectKey = scene3DArtifactObjectKey(
    input.userId,
    input.revisionId,
    input.artifactId,
    input.kind,
  )
  const ttl = seconds(input.ttlSeconds, SCENE3D_UPLOAD_TTL_SECONDS, 1800)
  const grace = seconds(input.graceSeconds, SCENE3D_UPLOAD_GRACE_SECONDS, 7 * 24 * 3600)
  const expiresAt = new Date(Date.now() + ttl * 1000)
  const collectAfter = new Date(expiresAt.getTime() + grace * 1000)

  try {
    return await callScene3DReserveUpload({
      artifact_id: input.artifactId,
      user_id: input.userId,
      job_id: input.jobId ?? null,
      revision_id: input.revisionId,
      kind: input.kind,
      bucket: store.bucket,
      object_key: objectKey,
      expires_at: expiresAt.toISOString(),
      collect_after: collectAfter.toISOString(),
    })
  } catch (error) {
    throw translateScene3DSqlError(error, "reserving the upload failed")
  }
}

/**
 * Read the uploaded object back, hash it, and record what was found.
 *
 * Also the answer to a conditional PUT that returned 412: the object is already
 * there, so the caller adopts it instead of re-uploading. Both paths need the
 * same thing — a durable statement of what these bytes are, made by the
 * platform rather than by the producer.
 *
 * The receipt is written once. Reading the same bytes again returns it; reading
 * different bytes is a conflict. If the reservation is gone the call fails: a
 * digest nobody could record is not a receipt.
 */
export async function receiveScene3DUpload(
  store: Scene3DObjectStore,
  input: { artifactId: string; userId: string },
): Promise<Scene3DUploadReceipt> {
  const intent = await loadScene3DUploadIntent(input.artifactId, input.userId)
  if (!intent) {
    throw new Scene3DArtifactError(
      "SCENE_ASSET_MISSING",
      `artifact ${input.artifactId} has no upload reservation`,
    )
  }
  if (intent.bucket !== store.bucket) {
    throw new Scene3DArtifactError(
      "SCENE_STORAGE_FAILED",
      "the reservation names a bucket this deployment is not configured for",
    )
  }

  const seen = await inspectScene3DObject(store, intent.objectKey, intent.kind)

  let stored: Scene3DUploadIntent
  try {
    stored = await callScene3DRecordUploadReceipt({
      artifact_id: intent.artifactId,
      user_id: intent.userId,
      kind: intent.kind,
      bucket: intent.bucket,
      object_key: intent.objectKey,
      sha256: seen.sha256,
      byte_length: seen.byteLength,
      etag: seen.etag,
    })
  } catch (error) {
    throw translateScene3DSqlError(error, "recording the upload receipt failed")
  }

  if (!stored.receipt) {
    throw new Scene3DArtifactError(
      "SCENE_STORAGE_FAILED",
      `the receipt for artifact ${input.artifactId} was not stored`,
    )
  }
  return stored.receipt
}

export async function scene3DUploadIntent(
  artifactId: string,
  userId: string,
): Promise<Scene3DUploadIntent | null> {
  return loadScene3DUploadIntent(artifactId, userId)
}
