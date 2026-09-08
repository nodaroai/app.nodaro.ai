import {
  applyScene3DV2EditOperations, scene3DPlanV2Schema,
  type Scene3DV2EditOperation, type Scene3DPlanV2,
} from "@nodaro/shared"
import { authorizeScene3DRevision } from "../scene3d-artifacts/authorize.js"
import { loadScene3DRevisionArtifacts } from "../scene3d-artifacts/db.js"
import { publishScene3DRevision } from "../scene3d-artifacts/publish.js"
import type { Scene3DObjectStore } from "../scene3d-artifacts/object-store.js"

export class Scene3DRetainedEditError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, readonly code: string, message: string) {
    super(message); this.name = "Scene3DRetainedEditError"
  }
}

export interface RetainedScene3DEditInput {
  revisionId: string
  newRevisionId: string
  expectedContentHash: string
  operations: readonly Scene3DV2EditOperation[]
  lockedObjectIds?: readonly string[]
}

/** Creates a retained revision without authoring, asset mutation or changing a workflow's active selection. */
export async function editRetainedScene3D(
  actorId: string,
  input: RetainedScene3DEditInput,
  store: Scene3DObjectStore | null,
  options: { assertActive?(): Promise<void> } = {},
): Promise<{ scenePlan: Scene3DPlanV2; changeSummary: string }> {
  await options.assertActive?.()
  const access = await authorizeScene3DRevision(actorId, input.revisionId, "source")
  if (!access.ok) throw new Scene3DRetainedEditError(access.reason === "forbidden" ? 403 : 404,
    access.reason === "forbidden" ? "forbidden" : "not_found", "Scene revision is unavailable for editing")
  if (!store) throw new Scene3DRetainedEditError(503, "scene_storage_unconfigured", "Scene asset storage is not configured")
  const parsed = scene3DPlanV2Schema.safeParse(access.revision.plan)
  if (!parsed.success) throw new Scene3DRetainedEditError(400, "validation_error", "This operation requires a retained v2 scene")
  const edited = await applyScene3DV2EditOperations(parsed.data as Scene3DPlanV2, input.operations, {
    expectedRevisionId: input.revisionId, expectedContentHash: input.expectedContentHash,
    newRevisionId: input.newRevisionId, lockedObjectIds: input.lockedObjectIds,
  })
  if (!edited.ok) throw new Scene3DRetainedEditError(edited.code === "stale_revision" ? 409 : 400, edited.code, edited.message)

  const retained = await loadScene3DRevisionArtifacts(input.revisionId)
  const used = new Set(edited.plan.assets.map((asset) => asset.assetId))
  // The rebuild recipe remains private and pinned. A previous .blend is not a
  // native export of these edits, so the new revision does not advertise it.
  const artifacts = retained.filter((artifact) => used.has(artifact.artifactId) || artifact.kind === "source-json")
    .map((artifact) => ({ artifactId: artifact.artifactId, kind: artifact.kind,
      sha256: artifact.sha256, byteLength: artifact.byteLength, expiresAt: artifact.expiresAt,
      reuseFromRevisionId: input.revisionId,
    }))
  // Recheck after preparation: a revoked collaborator must not publish a new
  // revision through a permission decision from an earlier request phase.
  const current = await authorizeScene3DRevision(actorId, input.revisionId, "source")
  if (!current.ok) throw new Scene3DRetainedEditError(403, "forbidden", "Scene editing access was revoked")
  await options.assertActive?.()
  await publishScene3DRevision({
    revisionId: edited.plan.revisionId, userId: access.revision.userId,
    workflowId: access.revision.workflowId, parentRevisionId: input.revisionId,
    plan: edited.plan, artifacts,
  }, { store })
  return { scenePlan: edited.plan, changeSummary: edited.changeSummary }
}
