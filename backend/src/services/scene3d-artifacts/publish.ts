import { createHash } from "node:crypto"
import {
  isScene3DPlanV2,
  parseScene3DCameraTrackJson,
  scene3DAnyPlanSchema,
  verifyScene3DPlanV2ContentHash,
  scene3DCameraTrackPlanIssues,
  type Scene3DPlanV2,
} from "@nodaro/shared"
import { callScene3DPublishRevision, loadScene3DPinnedArtifact } from "./db.js"
import { scene3DUploadIntent } from "./upload-intents.js"
import { translateScene3DSqlError } from "./sql-errors.js"
import { assertScene3DArtifactObjectKey, isScene3DId } from "./object-keys.js"
import { verifyScene3DArtifactBytes } from "./receipt.js"
import type { Scene3DObjectStore } from "./object-store.js"
import {
  SCENE3D_ARTIFACT_KIND_USAGE,
  Scene3DArtifactError,
  type Scene3DArtifactKind,
  type Scene3DArtifactPublishInput,
  type Scene3DPublishInput,
  type Scene3DPublishResult,
} from "./types.js"

/**
 * Publishing a revision: the only way bytes and a manifest become a scene.
 *
 * ## Order is the design
 *
 * Everything refusable happens before anything durable:
 *
 *   1. the manifest parses and is internally consistent (`@nodaro/shared`);
 *   2. a v2 manifest's own content hash matches its content;
 *   3. every asset the manifest names is actually being published, with the
 *      same kind, digest and length — and nothing user-visible is published
 *      that the manifest does not name;
 *   4. every new artifact's bytes are read back and verified at the exact key
 *      this platform granted (`receipt.ts`);
 *   5. and only then one RPC writes the revision, the artifacts and every pin
 *      in a single transaction — checking the parent job under a row lock and
 *      consuming each upload reservation as it goes.
 *
 * Any earlier arrangement has a window in which a manifest exists whose bytes
 * do not, or whose bytes are not what it says — and every consumer downstream
 * treats the manifest as the authority. There is deliberately no partial
 * success: publication either produced a complete, verified scene or produced
 * nothing.
 *
 * ## Replay
 *
 * The RPC is idempotent on identical input and refuses non-identical input for
 * an existing revision id. That is what makes this callable from a queue: a
 * re-delivery re-verifies the same bytes and returns `unchanged`, while a
 * rebuild that quietly produced different geometry under the same revision id
 * is a conflict rather than a silent overwrite of a scene someone is watching.
 *
 * ## What this function does NOT do
 *
 * It never writes workflow JSON. A revision may be scoped to a workflow, so
 * that deleting the workflow revokes it, but making it the workflow's active
 * scene is a separate compare-and-set operation — a build that finished late
 * must not overwrite canvas edits made while it ran.
 */

/** Kinds a v1 manifest cannot possibly reference. */
const V2_ONLY_KINDS: readonly Scene3DArtifactKind[] = ["glb", "camera-track-json"]

/** Recursive key-sorted JSON. The digest has to identify the CONTENT, not the
 *  key order a particular producer happened to serialize in. */
export function canonicalScene3DJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalScene3DJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalScene3DJson(v)}`)
  return `{${entries.join(",")}}`
}

export function scene3DPlanDigest(plan: unknown): string {
  return createHash("sha256").update(canonicalScene3DJson(plan), "utf8").digest("hex")
}

function invalid(message: string, detail?: string): never {
  throw new Scene3DArtifactError("SCENE_PLAN_INVALID", message, detail)
}

function asset(message: string, detail?: string): never {
  throw new Scene3DArtifactError("SCENE_ASSET_INVALID", message, detail)
}

/**
 * The manifest names exactly the bytes being published — in both directions.
 *
 * The forward direction (every declared asset is present) is the obvious one:
 * a manifest referencing a GLB nobody uploaded renders as a missing scene.
 * The reverse (nothing user-visible is published undeclared) matters just as
 * much: an artifact reachable through the read API that the manifest never
 * mentions is bytes with no description and no digest anyone checked.
 */
function assertPlanAssetsMatch(
  plan: Scene3DPlanV2,
  artifacts: readonly Scene3DArtifactPublishInput[],
): void {
  const published = new Map(artifacts.map((entry) => [entry.artifactId, entry]))

  for (const ref of plan.assets) {
    const entry = published.get(ref.assetId)
    if (!entry) {
      throw new Scene3DArtifactError(
        "SCENE_ASSET_MISSING",
        `the manifest references asset ${ref.assetId}, which is not being published`,
      )
    }
    if (entry.kind !== ref.kind) {
      asset(`asset ${ref.assetId} is published as ${entry.kind} but declared as ${ref.kind}`)
    }
    if (entry.sha256 !== ref.sha256) {
      asset(`asset ${ref.assetId} was published with a different digest than the manifest declares`)
    }
    if (entry.byteLength !== ref.byteLength) {
      asset(`asset ${ref.assetId} was published with a different length than the manifest declares`)
    }
  }

  const declared = new Set(plan.assets.map((ref) => ref.assetId))
  for (const entry of artifacts) {
    // `source-json` is the private recipe: never in a manifest, never readable.
    if (entry.kind === "source-json" || entry.kind === "input-glb") continue
    if (!declared.has(entry.artifactId)) {
      asset(`artifact ${entry.artifactId} is published but the manifest does not declare it`)
    }
  }

  const cameraTrack = plan.assets.find((ref) => ref.assetId === plan.cameraTrackAssetId)
  if (!cameraTrack || cameraTrack.kind !== "camera-track-json") {
    invalid("the manifest's cameraTrackAssetId does not resolve to a camera track asset")
  }
}

/** Reused bytes must be this owner's, pinned by the revision they claim to
 *  come from, and identical in kind, digest and length to what is declared. */
async function resolveReusedArtifact(
  entry: Scene3DArtifactPublishInput,
  userId: string,
): Promise<{ bucket: string; objectKey: string; etag: string }> {
  const originRevisionId = entry.reuseFromRevisionId ?? ""
  if (!isScene3DId(originRevisionId)) {
    asset(`artifact ${entry.artifactId} claims to reuse bytes from an invalid revision id`)
  }
  const existing = await loadScene3DPinnedArtifact(originRevisionId, entry.artifactId, userId)
  if (!existing) {
    throw new Scene3DArtifactError(
      "SCENE_ASSET_MISSING",
      `artifact ${entry.artifactId} is not retained by revision ${originRevisionId}`,
      "a cross-account copy must re-upload its bytes: an artifact can only ever be pinned by its own owner",
    )
  }
  if (
    existing.kind !== entry.kind ||
    existing.sha256 !== entry.sha256 ||
    existing.byteLength !== entry.byteLength
  ) {
    asset(`artifact ${entry.artifactId} does not match the retained bytes it claims to reuse`)
  }
  return { bucket: existing.bucket, objectKey: existing.objectKey, etag: existing.etag }
}

export async function publishScene3DRevision(
  input: Scene3DPublishInput,
  deps: { store: Scene3DObjectStore },
): Promise<Scene3DPublishResult> {
  const { store } = deps
  if (!isScene3DId(input.revisionId)) invalid("revisionId must be a UUID")
  if (!isScene3DId(input.userId)) invalid("userId must be a UUID")

  const parsed = scene3DAnyPlanSchema.safeParse(input.plan)
  if (!parsed.success) {
    invalid("the scene manifest is not a valid Scene3D plan", parsed.error.issues[0]?.message)
  }
  const plan = parsed.data
  if (plan.revisionId !== input.revisionId) {
    invalid("the scene manifest's revisionId does not match the revision being published")
  }

  const ids = new Set<string>()
  for (const entry of input.artifacts) {
    if (!isScene3DId(entry.artifactId)) asset("every artifactId must be a UUID")
    if (ids.has(entry.artifactId)) asset(`artifact ${entry.artifactId} is published twice`)
    ids.add(entry.artifactId)
    if (!SCENE3D_ARTIFACT_KIND_USAGE[entry.kind]) asset(`unknown artifact kind "${entry.kind}"`)
  }

  if (isScene3DPlanV2(plan)) {
    if (!(await verifyScene3DPlanV2ContentHash(plan))) {
      invalid("the manifest's provenance.contentHash does not match its content")
    }
    assertPlanAssetsMatch(plan, input.artifacts)
    const inputs = input.artifacts.filter(entry => entry.kind === "input-glb")
    if (inputs.length > 8 || inputs.some(entry => entry.byteLength > 64 * 1024 * 1024) ||
        inputs.reduce((sum, entry) => sum + entry.byteLength, 0) > 128 * 1024 * 1024 ||
        (inputs.length > 0 && input.artifacts.filter(entry => entry.kind === "source-json").length !== 1)) {
      asset("retained scene inputs require one authoring source and bounded input bytes")
    }
  } else {
    const stray = input.artifacts.find((entry) => V2_ONLY_KINDS.includes(entry.kind) || entry.kind === "input-glb")
    if (stray) {
      asset(`a v1 scene cannot publish a ${stray.kind} artifact: it has no way to reference it`)
    }
  }

  // ---- Receipt: nothing durable has happened yet, and nothing will unless
  // every byte checks out. -------------------------------------------------
  const rows: Record<string, unknown>[] = []
  for (const entry of input.artifacts) {
    if (entry.reuseFromRevisionId) {
      const reused = await resolveReusedArtifact(entry, input.userId)
      rows.push({
        artifact_id: entry.artifactId,
        kind: entry.kind,
        usage: SCENE3D_ARTIFACT_KIND_USAGE[entry.kind],
        bucket: reused.bucket,
        object_key: reused.objectKey,
        sha256: entry.sha256,
        byte_length: entry.byteLength,
        etag: reused.etag,
        expires_at: entry.expiresAt ?? null,
        reuse: true,
      })
      continue
    }

    const objectKey = assertScene3DArtifactObjectKey(
      entry.objectKey,
      input.userId,
      input.revisionId,
      entry.artifactId,
      entry.kind,
    )
    await assertReservationAgrees(entry, input.userId)
    const receipt = await verifyScene3DArtifactBytes(store, objectKey, {
      kind: entry.kind,
      sha256: entry.sha256,
      byteLength: entry.byteLength,
    })

    if (entry.kind === "camera-track-json" && isScene3DPlanV2(plan)) {
      assertCameraTrackMatchesPlan(receipt.text ?? "", plan)
    }

    rows.push({
      artifact_id: entry.artifactId,
      kind: entry.kind,
      usage: SCENE3D_ARTIFACT_KIND_USAGE[entry.kind],
      bucket: store.bucket,
      object_key: objectKey,
      sha256: entry.sha256,
      byte_length: entry.byteLength,
      etag: receipt.etag,
      expires_at: entry.expiresAt ?? null,
      reuse: false,
    })
  }

  let status: "created" | "unchanged"
  try {
    status = await callScene3DPublishRevision({
      revision_id: input.revisionId,
      user_id: input.userId,
      workflow_id: input.workflowId ?? null,
      source_job_id: input.sourceJobId ?? null,
      parent_revision_id: input.parentRevisionId ?? null,
      plan,
      plan_sha256: scene3DPlanDigest(plan),
      require_intents: input.requireIntents ?? false,
      artifacts: rows,
    })
  } catch (error) {
    throw translatePublishError(error)
  }

  return { revisionId: input.revisionId, status, artifactIds: [...ids] }
}

/**
 * If these bytes were received under a reservation, what is being published
 * has to be what was received. The producer computes the digest it declares;
 * the receipt is the one the platform computed itself.
 */
async function assertReservationAgrees(
  entry: Scene3DArtifactPublishInput,
  userId: string,
): Promise<void> {
  const intent = await scene3DUploadIntent(entry.artifactId, userId)
  if (!intent?.receipt) return
  if (intent.receipt.sha256 !== entry.sha256 || intent.receipt.byteLength !== entry.byteLength) {
    asset(`artifact ${entry.artifactId} does not match the bytes that were received for it`)
  }
}

/** The baked track has to agree with the manifest it ships with — same fps,
 *  same frame count, same aspect. A mismatch is a scene that renders, badly. */
function assertCameraTrackMatchesPlan(text: string, plan: Scene3DPlanV2): void {
  const track = parseScene3DCameraTrackJson(text)
  if (!track.ok) {
    asset("the camera track artifact is not a valid scene3d-camera-track", track.issues[0]?.message)
  }
  const issues = scene3DCameraTrackPlanIssues(track.value, plan)
  if (issues.length > 0) {
    asset("the camera track does not match the manifest it is published with", issues[0]?.message)
  }
}

/** @deprecated Use `translateScene3DSqlError`; kept as the publish-side name. */
export function translatePublishError(error: unknown): Scene3DArtifactError {
  return translateScene3DSqlError(error, "publishing the scene failed")
}
