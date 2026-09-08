import { accessAtLeast } from "../workflow-access.js"
import { authorizeScene3DRevision, type Scene3DArtifactAuthorization } from "../../services/scene3d-artifacts/authorize.js"
import { loadScene3DPinnedArtifact } from "../../services/scene3d-artifacts/db.js"
import { isScene3DId } from "../../services/scene3d-artifacts/object-keys.js"

/** Retained private inputs require edit access; ordinary GLBs use playback access. */
export async function authorizeScene3DInputArtifact(userId: string, revisionId: string, assetId: string): Promise<Scene3DArtifactAuthorization> {
  if (!isScene3DId(assetId)) return { ok: false, reason: "not-found" }
  const allowed = await authorizeScene3DRevision(userId, revisionId, "playback")
  if (!allowed.ok) return allowed
  const artifact = await loadScene3DPinnedArtifact(revisionId, assetId, allowed.revision.userId)
  if (!artifact) return { ok: false, reason: "not-found" }
  if (artifact.kind === "input-glb" && artifact.usage === "checkpoint") {
    if (!accessAtLeast(allowed.access, "edit")) return { ok: false, reason: "forbidden" }
  } else if (artifact.kind !== "glb" || artifact.usage !== "playback") {
    return { ok: false, reason: "not-found" }
  }
  return { ok: true, revision: allowed.revision, artifact }
}
