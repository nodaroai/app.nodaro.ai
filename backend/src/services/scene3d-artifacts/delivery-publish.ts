import { scene3DAnyPlanSchema } from "@nodaro/shared"
import { isScene3DId, assertScene3DArtifactObjectKey } from "./object-keys.js"
import { SCENE3D_ARTIFACT_KIND_USAGE, Scene3DArtifactError } from "./types.js"
import { SCENE3D_DELIVERY_KINDS, type Scene3DDeliveryPublishInput, type Scene3DDeliveryPublishResult } from "./delivery-types.js"
import { authorizeScene3DDelivery } from "./delivery-authorize.js"
import { callScene3DPublishDelivery, loadScene3DDelivery, loadScene3DDeliveryArtifacts } from "./delivery-db.js"
import { loadScene3DPinnedArtifact, loadScene3DUploadIntent } from "./db.js"
import { resolveScene3DDeliverySource } from "./delivery-source.js"
import { scene3DPlanDigest } from "./publish.js"
import { verifyScene3DArtifactBytes } from "./receipt.js"
import { translateScene3DSqlError } from "./sql-errors.js"
import type { Scene3DObjectStore } from "./object-store.js"

function invalid(message: string): never { throw new Scene3DArtifactError("SCENE_ASSET_INVALID", message) }
function conflict(message: string): never { throw new Scene3DArtifactError("SCENE_REVISION_CONFLICT", message) }

function validate(input: Scene3DDeliveryPublishInput): string {
  if (![input.jobId, input.userId, input.revisionId].every(isScene3DId)) invalid("Scene delivery IDs must be UUIDs")
  if (!input.source || !["retained-revision", "job-output"].includes(input.source.kind)
    || !["authored", "render-only"].includes(input.mode)) invalid("Unknown scene delivery source or mode")
  const parsed = scene3DAnyPlanSchema.safeParse(input.plan)
  if (!parsed.success || parsed.data.revisionId !== input.revisionId) invalid("Invalid scene delivery manifest")
  if (!Array.isArray(input.artifacts) || input.artifacts.length < 2 || input.artifacts.length > 3
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
  }
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
    if (!artifact || artifact.kind !== entry.kind || artifact.sha256 !== entry.sha256
      || artifact.byteLength !== entry.byteLength || artifact.viaRevisionId !== (entry.reuseFromRevisionId ?? null)
      || (entry.objectKey !== undefined && entry.objectKey !== artifact.objectKey)) {
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
    rows.push({ artifact_id: entry.artifactId, artifact_owner_id: ownerId, kind: entry.kind,
      usage: SCENE3D_ARTIFACT_KIND_USAGE[entry.kind], sha256: entry.sha256, byte_length: entry.byteLength,
      bucket: location.bucket, object_key: location.objectKey, etag: location.etag,
      via_revision_id: entry.reuseFromRevisionId ?? null })
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
