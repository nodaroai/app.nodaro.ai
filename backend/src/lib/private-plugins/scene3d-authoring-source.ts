import { createHash } from "node:crypto"
import { scene3DPlanV2Schema, verifyScene3DPlanV2ContentHash, type Scene3DPlanV2 } from "@nodaro/shared"
import { authorizeScene3DRevision } from "../../services/scene3d-artifacts/authorize.js"
import { loadScene3DRevisionArtifacts } from "../../services/scene3d-artifacts/db.js"
import { isScene3DId } from "../../services/scene3d-artifacts/object-keys.js"
import type { Scene3DObjectStore } from "../../services/scene3d-artifacts/object-store.js"
import {
  SCENE3D_ARTIFACT_KIND_USAGE,
  Scene3DArtifactError,
  type Scene3DPinnedArtifact,
} from "../../services/scene3d-artifacts/types.js"
import type { PluginSceneAuthoringSource, PluginSceneAuthoringSourceRequest } from "./scene3d-artifact-contract.js"

/**
 * The recipe of a revision that is already published, for re-authoring it.
 *
 * Different from `toolkit.read`, which only reaches this job's own upload
 * reservations: the bytes wanted here were written by an earlier, finished
 * job. So the authorization is not ownership of a reservation but the retained
 * revision itself — `authorizeScene3DRevision(..., "source")`, which asks the
 * workflow seam by id even when the actor created the scene, so a removed
 * collaborator loses the recipe with everything else.
 *
 * Two consequences worth naming:
 *
 *   - the pin is the authority, not the producer. A revision made by a manual
 *     edit reuses the recipe of the revision it came from, so the artifact row
 *     names another job and possibly another owner. Requiring "same user"
 *     would refuse exactly the collaborator case this exists for; requiring
 *     "pinned by the revision the caller was authorized for" is the real rule.
 *   - the lane allowlists do NOT select these bytes. `source-json` is absent
 *     from both on purpose (it is what keeps the recipe out of every
 *     user-visible response), so selection here is by kind and usage directly
 *     and the bytes never leave the private toolkit.
 */

/** The recipe is bounded JSON; the cap is enforced before the read and again during it. */
const SOURCE_JSON_MAX_BYTES = 8 * 1024 * 1024
const SHA256_RE = /^[a-f0-9]{64}$/
const SOURCE_KIND = "source-json"
const SOURCE_USAGE = SCENE3D_ARTIFACT_KIND_USAGE[SOURCE_KIND]

export interface Scene3DAuthoringSourceDeps {
  store: Scene3DObjectStore
  /** The active owned parent job. Injected so the toolkit stays the one place that asks. */
  authorizeJob(scope: { jobId: string; userId: string }): Promise<unknown>
}

/** Only an affirmative "no such object" is missing; everything else is an outage. */
function isAffirmativeNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.name === "NoSuchKey" || candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404
}

function detailOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

async function authorizeSourceRevision(userId: string, revisionId: string) {
  const access = await authorizeScene3DRevision(userId, revisionId, "source")
  if (!access.ok) {
    throw access.reason === "forbidden"
      ? new Scene3DArtifactError("SCENE_JOB_INVALID", "Scene revision is not editable by this job's owner")
      : new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene revision is unavailable")
  }
  return access
}

/** The stored plan must be the exact v2 revision the caller prepared against. */
async function parsePublishedPlan(plan: unknown, input: PluginSceneAuthoringSourceRequest): Promise<Scene3DPlanV2> {
  const parsed = scene3DPlanV2Schema.safeParse(plan)
  if (!parsed.success) {
    throw new Scene3DArtifactError("SCENE_PLAN_INVALID", "Retained scene is not a valid v2 revision")
  }
  const published = parsed.data as Scene3DPlanV2
  if (published.revisionId !== input.revisionId) {
    throw new Scene3DArtifactError("SCENE_PLAN_INVALID", "Retained scene does not carry its own revision identity")
  }
  if (published.provenance.contentHash !== input.expectedContentHash) {
    throw new Scene3DArtifactError("SCENE_REVISION_CONFLICT", "The scene changed since this edit was prepared")
  }
  // The declared hash agreeing with the request proves nothing about the bytes:
  // recompute it over the stored plan before trusting either.
  if (!(await verifyScene3DPlanV2ContentHash(published))) {
    throw new Scene3DArtifactError("SCENE_PLAN_INVALID", "Retained scene does not match its digest")
  }
  return published
}

function selectPinnedSource(pinned: Scene3DPinnedArtifact[]): Scene3DPinnedArtifact {
  const found = pinned.filter((artifact) => artifact.kind === SOURCE_KIND && artifact.usage === SOURCE_USAGE)
  if (found.length === 0) {
    throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "This revision pins no authoring source")
  }
  if (found.length > 1) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "This revision pins more than one authoring source")
  }
  return found[0]!
}

/** Everything checkable without touching the store, checked before touching it. */
function assertStoredHere(store: Scene3DObjectStore, artifact: Scene3DPinnedArtifact): void {
  if (artifact.bucket !== store.bucket) {
    throw new Scene3DArtifactError("SCENE_STORAGE_FAILED",
      "The authoring source is stored in a bucket this deployment is not configured for")
  }
  if (artifact.expiresAt !== null) {
    const expiresAt = Date.parse(artifact.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "The authoring source has expired")
    }
  }
  if (!SHA256_RE.test(artifact.sha256) || !Number.isSafeInteger(artifact.byteLength) ||
      artifact.byteLength <= 0 || artifact.byteLength > SOURCE_JSON_MAX_BYTES) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "The authoring source exceeds the buffered read limit")
  }
}

async function readVerifiedBytes(
  store: Scene3DObjectStore,
  artifact: Scene3DPinnedArtifact,
  options?: { signal?: AbortSignal },
): Promise<Buffer> {
  let read
  try {
    read = await store.get(artifact.objectKey)
  } catch (error) {
    options?.signal?.throwIfAborted()
    // `openScene3DArtifactStream` calls every failure here missing; a store
    // outage is not a deleted recipe, and retrying is the right answer to one.
    throw isAffirmativeNotFound(error)
      ? new Scene3DArtifactError("SCENE_ASSET_MISSING", "The authoring source is no longer available", detailOf(error))
      : new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Reading the authoring source failed", detailOf(error))
  }
  const abort = () => read.body.destroy(new Error("Scene authoring source read aborted"))
  options?.signal?.addEventListener("abort", abort, { once: true })
  if (options?.signal?.aborted) abort()
  const chunks: Buffer[] = []
  const hash = createHash("sha256")
  let length = 0
  try {
    if (read.contentLength !== null && read.contentLength !== artifact.byteLength) {
      throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "The authoring source does not match its recorded length")
    }
    for await (const chunk of read.body) {
      options?.signal?.throwIfAborted()
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += bytes.length
      if (length > artifact.byteLength || length > SOURCE_JSON_MAX_BYTES) {
        throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "The authoring source is longer than its recorded length")
      }
      hash.update(bytes)
      chunks.push(bytes)
    }
    if (length !== artifact.byteLength || hash.digest("hex") !== artifact.sha256) {
      throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "The authoring source changed after it was published")
    }
    return Buffer.concat(chunks, length)
  } catch (error) {
    options?.signal?.throwIfAborted()
    if (error instanceof Scene3DArtifactError) throw error
    throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Reading the authoring source failed", detailOf(error))
  } finally {
    options?.signal?.removeEventListener("abort", abort)
    read.body.destroy()
  }
}

export async function readScene3DAuthoringSource(
  deps: Scene3DAuthoringSourceDeps,
  input: PluginSceneAuthoringSourceRequest,
  options?: { signal?: AbortSignal },
): Promise<PluginSceneAuthoringSource> {
  options?.signal?.throwIfAborted()
  // Before any IO: a non-UUID reaching Postgres is a cast error, which is a 500
  // that tells a prober their input arrived somewhere.
  if (!input || typeof input !== "object" || !isScene3DId(input.jobId) || !isScene3DId(input.userId) || !isScene3DId(input.revisionId) ||
      typeof input.expectedContentHash !== "string" || !SHA256_RE.test(input.expectedContentHash)) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene authoring source request is malformed")
  }
  const scope = { jobId: input.jobId, userId: input.userId }
  await deps.authorizeJob(scope)
  const access = await authorizeSourceRevision(input.userId, input.revisionId)
  const plan = await parsePublishedPlan(access.revision.plan, input)
  const pins = await loadScene3DRevisionArtifacts(input.revisionId)
  const artifact = selectPinnedSource(pins)
  const inputArtifacts = pinnedInputs(deps.store, pins)
  assertStoredHere(deps.store, artifact)
  const source = await readVerifiedBytes(deps.store, artifact, options)
  // Recheck after the transfer: a job cancelled or a collaborator removed while
  // the bytes were moving must not be answered with the bytes.
  options?.signal?.throwIfAborted()
  await deps.authorizeJob(scope)
  await authorizeSourceRevision(input.userId, input.revisionId)
  const currentInputs = pinnedInputs(deps.store, await loadScene3DRevisionArtifacts(input.revisionId))
  if (JSON.stringify(currentInputs) !== JSON.stringify(inputArtifacts)) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Retained scene inputs changed during the source read")
  }
  options?.signal?.throwIfAborted()
  assertStoredHere(deps.store, artifact)
  return { plan, source, sourceArtifactId: artifact.artifactId, sourceSha256: artifact.sha256, inputArtifacts }
}

/** Private dependency pins travel only to the trusted authoring engine. */
function pinnedInputs(store: Scene3DObjectStore, pins: readonly Scene3DPinnedArtifact[]) {
  const inputs = pins.filter(pin => pin.kind === "input-glb")
  if (inputs.length > 8 || inputs.reduce((sum, pin) => sum + pin.byteLength, 0) > 128 * 1024 * 1024) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Retained scene inputs exceed their limits")
  }
  return inputs.map(pin => {
    if (pin.usage !== "checkpoint" || pin.bucket !== store.bucket || !isScene3DId(pin.artifactId) ||
        !SHA256_RE.test(pin.sha256) || !Number.isSafeInteger(pin.byteLength) || pin.byteLength < 12 || pin.byteLength > 64 * 1024 * 1024 ||
        (pin.expiresAt !== null && !(Date.parse(pin.expiresAt) > Date.now()))) {
      throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Retained scene input has an invalid receipt")
    }
    return { assetId: pin.artifactId, kind: "glb" as const, sha256: pin.sha256, byteLength: pin.byteLength }
  }).sort((a, b) => a.assetId.localeCompare(b.assetId))
}
