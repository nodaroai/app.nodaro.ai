import { scene3DAnyPlanSchema } from "@nodaro/shared"
import { isScene3DId, assertScene3DArtifactObjectKey } from "./object-keys.js"
import { SCENE3D_ARTIFACT_KIND_USAGE, Scene3DArtifactError } from "./types.js"
import { SCENE3D_DELIVERY_KINDS, type Scene3DDeliveryPublishInput, type Scene3DDeliveryPublishResult } from "./delivery-types.js"
import { authorizeScene3DDelivery } from "./delivery-authorize.js"
import { callScene3DPublishDelivery, loadScene3DDelivery, loadScene3DDeliveryArtifacts } from "./delivery-db.js"
import { loadScene3DPinnedArtifact, loadScene3DUploadIntent } from "./db.js"
import { resolveScene3DDeliverySource } from "./delivery-source.js"
import { assertScene3DShotStillClaims, scene3DShotStillDimensions } from "./shot-stills.js"
import { scene3DPlanDigest } from "./publish.js"
import { verifyScene3DArtifactBytes } from "./receipt.js"
import { translateScene3DSqlError } from "./sql-errors.js"
import type { Scene3DObjectStore } from "./object-store.js"

function invalid(message: string): never { throw new Scene3DArtifactError("SCENE_ASSET_INVALID", message) }
function isFrameIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
function conflict(message: string): never { throw new Scene3DArtifactError("SCENE_REVISION_CONFLICT", message) }

function validate(input: Scene3DDeliveryPublishInput): string {
  if (![input.jobId, input.userId, input.revisionId].every(isScene3DId)) invalid("Scene delivery IDs must be UUIDs")
  if (!input.source || !["retained-revision", "job-output"].includes(input.source.kind)
    || !["authored", "render-only"].includes(input.mode)) invalid("Unknown scene delivery source or mode")
  const parsed = scene3DAnyPlanSchema.safeParse(input.plan)
  if (!parsed.success || parsed.data.revisionId !== input.revisionId) invalid("Invalid scene delivery manifest")
  if (!Array.isArray(input.artifacts)) invalid("A scene delivery requires a poster and validation report")
  const stills = input.artifacts.filter((a) => a.kind === "shot-still")
  // Stills are ADDITIVE: the mandatory evidence is still exactly one poster and
  // one or two reports, and a producer that renders no stills yet delivers a
  // complete, valid result.
  const evidence = input.artifacts.length - stills.length
  if (evidence < 2 || evidence > 3
    || new Set(input.artifacts.map((a) => a.artifactId)).size !== input.artifacts.length
    || input.artifacts.filter((a) => a.kind === "poster").length !== 1
    || input.artifacts.filter((a) => a.kind === "validation-report").length < 1) {
    invalid("A scene delivery requires a poster and validation report")
  }
  for (const entry of input.artifacts) {
    if (!isScene3DId(entry.artifactId) || !SCENE3D_DELIVERY_KINDS.includes(entry.kind)
      || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.byteLength) || entry.byteLength <= 0
      || (entry.reuseFromRevisionId != null && entry.reuseFromRevisionId !== input.revisionId)) {
      invalid("Invalid scene delivery artifact descriptor")
    }
    const isStill = entry.kind === "shot-still"
    // A shot identity belongs to a still and to nothing else: a poster wearing
    // one would be read back as a still of a shot it never showed.
    if (!isStill && (entry.shotIndex !== undefined || entry.frame !== undefined
      || entry.width !== undefined || entry.height !== undefined)) {
      invalid("Only a shot still carries a shot identity")
    }
    if (isStill) {
      if (!isFrameIndex(entry.shotIndex) || !isFrameIndex(entry.frame)) {
        invalid("A shot still must name its shot index and its frame")
      }
      // A revision pins no stills, so there is nothing to reuse from one.
      if (entry.reuseFromRevisionId != null) invalid("A shot still cannot be reused from a revision")
      scene3DShotStillDimensions(parsed.data, entry)
    }
  }
  assertScene3DShotStillClaims(parsed.data, stills as ReadonlyArray<{ shotIndex: number; frame: number }>)
  return scene3DPlanDigest(input.plan)
}

/** A replay needs current delivery permissions, but no consumed upload intents. */
async function replay(input: Scene3DDeliveryPublishInput, planSha256: string): Promise<Scene3DDeliveryPublishResult | null> {
  const existing = await loadScene3DDelivery(input.jobId)
  if (!existing) return null
  const auth = await authorizeScene3DDelivery(input.userId, input.jobId)
  if (!auth.ok || existing.userId !== input.userId) {
    throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene delivery is unavailable")
  }
  if (existing.sourceKind !== input.source.kind || existing.sourceRevisionId !== input.revisionId
    || existing.sourcePlanSha256 !== planSha256 || existing.mode !== input.mode
    || (input.source.jobId !== undefined && existing.sourceJobId !== null && input.source.jobId !== existing.sourceJobId)) {
    conflict("Scene delivery already exists with different content")
  }
  const artifacts = await loadScene3DDeliveryArtifacts(input.jobId)
  if (artifacts.length !== input.artifacts.length) conflict("Scene delivery already exists with different artifacts")
  for (const entry of input.artifacts) {
    const artifact = artifacts.find((a) => a.artifactId === entry.artifactId)
    const pinned = entry.kind === "shot-still"
      ? scene3DShotStillDimensions(input.plan, entry)
      : null
    if (!artifact || artifact.kind !== entry.kind || artifact.sha256 !== entry.sha256
      || artifact.byteLength !== entry.byteLength || artifact.viaRevisionId !== (entry.reuseFromRevisionId ?? null)
      || (entry.objectKey !== undefined && entry.objectKey !== artifact.objectKey)
      // A replay that moved a still to another shot or frame is a DIFFERENT
      // delivery wearing the same ids, not the same one settled twice.
      || artifact.shotIndex !== (entry.shotIndex ?? null) || artifact.frame !== (entry.frame ?? null)
      || artifact.width !== (pinned?.width ?? null) || artifact.height !== (pinned?.height ?? null)) {
      conflict("Scene delivery already exists with different artifacts")
    }
  }
  return { deliveryId: input.jobId, revisionId: input.revisionId, status: "unchanged", artifactIds: input.artifacts.map((a) => a.artifactId) }
}

export async function publishScene3DDelivery(
  input: Scene3DDeliveryPublishInput,
  deps: { store: Scene3DObjectStore; authorizeJob: (scope: { jobId: string; userId: string }) => Promise<{ workflowId: string | null }> },
): Promise<Scene3DDeliveryPublishResult> {
  const planSha256 = validate(input)
  const existing = await replay(input, planSha256)
  if (existing) return existing
  await deps.authorizeJob(input)
  const source = await resolveScene3DDeliverySource(input, planSha256)
  const rows: Record<string, unknown>[] = []
  for (const entry of input.artifacts) {
    let location: { bucket: string; objectKey: string; etag: string }
    let ownerId = input.userId
    if (entry.reuseFromRevisionId) {
      if (input.source.kind !== "retained-revision") invalid("Only retained scene artifacts can be reused")
      const asset = await loadScene3DPinnedArtifact(input.revisionId, entry.artifactId, source.sourceOwnerId)
      if (!asset || asset.kind !== entry.kind || asset.sha256 !== entry.sha256 || asset.byteLength !== entry.byteLength
        || asset.usage !== SCENE3D_ARTIFACT_KIND_USAGE[entry.kind]
        || (entry.objectKey !== undefined && entry.objectKey !== asset.objectKey)) {
        conflict("Scene delivery artifact does not match its retained source")
      }
      location = asset
      ownerId = asset.userId
    } else {
      const objectKey = assertScene3DArtifactObjectKey(entry.objectKey, input.userId, input.revisionId, entry.artifactId, entry.kind)
      const intent = await loadScene3DUploadIntent(entry.artifactId, input.userId)
      if (!intent) {
        const concurrentPublication = await replay(input, planSha256)
        if (concurrentPublication) return concurrentPublication
      }
      if (!intent || intent.jobId !== input.jobId || intent.revisionId !== input.revisionId
        || intent.kind !== entry.kind || intent.bucket !== deps.store.bucket || intent.objectKey !== objectKey) {
        throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene delivery artifact is not reserved by this parent")
      }
      const receipt = await verifyScene3DArtifactBytes(deps.store, objectKey, entry)
      if (intent.receipt && (intent.receipt.sha256 !== entry.sha256 || intent.receipt.byteLength !== entry.byteLength
        || intent.receipt.etag !== receipt.etag)) conflict("Scene delivery artifact differs from its receipt")
      location = { bucket: deps.store.bucket, objectKey, etag: receipt.etag }
    }
    const still = entry.kind === "shot-still"
      ? scene3DShotStillDimensions(input.plan, entry)
      : null
    rows.push({ artifact_id: entry.artifactId, artifact_owner_id: ownerId, kind: entry.kind,
      usage: SCENE3D_ARTIFACT_KIND_USAGE[entry.kind], sha256: entry.sha256, byte_length: entry.byteLength,
      bucket: location.bucket, object_key: location.objectKey, etag: location.etag,
      via_revision_id: entry.reuseFromRevisionId ?? null,
      shot_index: still ? entry.shotIndex : null, frame: still ? entry.frame : null,
      width: still?.width ?? null, height: still?.height ?? null })
  }
  // Transfers may take time. Ask both authorities again before the atomic write.
  await deps.authorizeJob(input)
  const currentSource = await resolveScene3DDeliverySource(input, planSha256)
  if (JSON.stringify(currentSource) !== JSON.stringify(source)) conflict("Scene delivery source changed during publication")
  try {
    const status = await callScene3DPublishDelivery({ job_id: input.jobId, user_id: input.userId,
      source_kind: input.source.kind, source_revision_id: input.revisionId, source_plan_sha256: planSha256,
      source_content_hash: source.sourceContentHash, source_job_id: source.sourceJobId,
      source_owner_id: source.sourceOwnerId, source_workflow_id: source.sourceWorkflowId,
      source_plan: input.source.kind === "job-output" ? input.plan : undefined,
      mode: input.mode, artifacts: rows })
    return { deliveryId: input.jobId, revisionId: input.revisionId, status, artifactIds: input.artifacts.map((a) => a.artifactId) }
  } catch (error) {
    throw translateScene3DSqlError(error, "Could not publish scene delivery")
  }
}
