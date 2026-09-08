import { accessAtLeast, workflowAccess, type AccessLevel } from "../../lib/workflow-access.js"
import { isScene3DId } from "./object-keys.js"
import { loadScene3DDelivery, loadScene3DDeliveryArtifacts } from "./delivery-db.js"
import { SCENE3D_DELIVERY_KINDS, type Scene3DDeliveryRecord, type Scene3DDeliveryArtifact } from "./delivery-types.js"
import { SCENE3D_ARTIFACT_KIND_USAGE } from "./types.js"
import type { Scene3DDenial } from "./authorize.js"

export type Scene3DDeliveryAuthorization =
  | { ok: true; delivery: Scene3DDeliveryRecord; access: AccessLevel }
  | Scene3DDenial

async function scopeAccess(actorId: string, ownerId: string, workflowId: string | null): Promise<AccessLevel> {
  return workflowId ? workflowAccess(actorId, workflowId) : actorId === ownerId ? "own" : "none"
}

/** Both anchors survive source revision deletion. Absence never grants access. */
export async function authorizeScene3DDelivery(actorId: string, jobId: string): Promise<Scene3DDeliveryAuthorization> {
  if (!isScene3DId(jobId)) return { ok: false, reason: "not-found" }
  const delivery = await loadScene3DDelivery(jobId)
  if (!delivery) return { ok: false, reason: "not-found" }
  const ownAccess = await scopeAccess(actorId, delivery.userId, delivery.workflowId)
  if (ownAccess === "none") return { ok: false, reason: "not-found" }
  const sourceAccess = await scopeAccess(actorId, delivery.sourceOwnerId, delivery.sourceWorkflowId)
  if (sourceAccess === "none") return { ok: false, reason: "not-found" }
  const access = accessAtLeast(ownAccess, sourceAccess) ? sourceAccess : ownAccess
  return { ok: true, delivery, access }
}

export function scene3DDeliveryArtifactReadable(artifact: Scene3DDeliveryArtifact): boolean {
  return (SCENE3D_DELIVERY_KINDS as readonly string[]).includes(artifact.kind)
    && SCENE3D_ARTIFACT_KIND_USAGE[artifact.kind] === artifact.usage
}

export async function authorizeScene3DDeliveryArtifact(
  actorId: string, jobId: string, artifactId: string,
): Promise<{ ok: true; delivery: Scene3DDeliveryRecord; artifact: Scene3DDeliveryArtifact } | Scene3DDenial> {
  if (!isScene3DId(artifactId)) return { ok: false, reason: "not-found" }
  const auth = await authorizeScene3DDelivery(actorId, jobId)
  if (!auth.ok) return auth
  const artifact = (await loadScene3DDeliveryArtifacts(jobId))
    .find((item) => item.artifactId === artifactId && scene3DDeliveryArtifactReadable(item))
  if (!artifact) return { ok: false, reason: "not-found" }
  return { ok: true, delivery: auth.delivery, artifact }
}
