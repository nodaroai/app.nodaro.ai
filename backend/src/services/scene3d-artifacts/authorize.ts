import { accessAtLeast, workflowAccess, type AccessLevel } from "../../lib/workflow-access.js"
import { loadScene3DPinnedArtifact, loadScene3DRevision } from "./db.js"
import { isScene3DId } from "./object-keys.js"
import {
  SCENE3D_ARTIFACT_KIND_USAGE,
  scene3DLaneKinds,
  type Scene3DPinnedArtifact,
  type Scene3DReadLane,
  type Scene3DRevisionRecord,
} from "./types.js"

/**
 * Who may read a revision, and its bytes.
 *
 * ## The rule, and the shortcut this file refuses to take
 *
 * A revision attached to a workflow is authorized by `workflowAccess(actor,
 * workflowId)` — **always, by id, even when the actor created it.** The
 * tempting version is "creator? then allow, and only ask the seam for other
 * people", and it is wrong in the case that matters: a member suspended from a
 * workspace, or a workspace that has been archived, still created the scenes
 * they created. The organization rule refuses them and a creator shortcut
 * would not, so revocation would apply to everything in the product except the
 * `.blend` of the work they were removed from.
 *
 * A revision with no workflow has no seam to ask: it is personal, and its
 * owner is the only reader.
 *
 * ## Two lanes, deliberately not one permission
 *
 * Watching a preview and downloading the editable native project are different
 * powers. Playback needs `view`; the `.blend` needs `edit`. A viewer invited to
 * look at a class's scene can look at it, and cannot walk away with the source.
 *
 * ## 404, never 403, for "you may not reach this"
 *
 * Same posture as `loadWorkflowFor`: a revision you cannot reach is
 * indistinguishable from one that does not exist. 403 is reserved for the case
 * where the caller can already see the thing and is being told they may look
 * but not take.
 */

/** Playback (GLB, camera track, poster, validation report). */
export const SCENE3D_PLAYBACK_MIN_ACCESS: Exclude<AccessLevel, "none"> = "view"
/** The `.blend` export. Raise to `"own"` to make it creator-only. */
export const SCENE3D_SOURCE_MIN_ACCESS: Exclude<AccessLevel, "none"> = "edit"

export function scene3DLaneMinAccess(lane: Scene3DReadLane): Exclude<AccessLevel, "none"> {
  return lane === "source" ? SCENE3D_SOURCE_MIN_ACCESS : SCENE3D_PLAYBACK_MIN_ACCESS
}

export type Scene3DDenial = { ok: false; reason: "not-found" | "forbidden" }

export type Scene3DRevisionAuthorization =
  | { ok: true; revision: Scene3DRevisionRecord; access: AccessLevel }
  | Scene3DDenial

export type Scene3DArtifactAuthorization =
  | { ok: true; revision: Scene3DRevisionRecord; artifact: Scene3DPinnedArtifact }
  | Scene3DDenial

export async function scene3DRevisionAccess(
  actorId: string,
  revision: Scene3DRevisionRecord,
): Promise<AccessLevel> {
  if (revision.workflowId) return workflowAccess(actorId, revision.workflowId)
  return revision.userId === actorId ? "own" : "none"
}

export async function authorizeScene3DRevision(
  actorId: string,
  revisionId: string,
  lane: Scene3DReadLane,
): Promise<Scene3DRevisionAuthorization> {
  // A malformed id is a miss, not a database error: Postgres rejects a
  // non-UUID cast and that would surface as a 500 telling a prober that their
  // input reached the database.
  if (!isScene3DId(revisionId)) return { ok: false, reason: "not-found" }

  const revision = await loadScene3DRevision(revisionId)
  if (!revision) return { ok: false, reason: "not-found" }

  const access = await scene3DRevisionAccess(actorId, revision)
  if (access === "none") return { ok: false, reason: "not-found" }
  if (!accessAtLeast(access, scene3DLaneMinAccess(lane))) return { ok: false, reason: "forbidden" }
  return { ok: true, revision, access }
}

/**
 * One artifact, reached through the revision that pins it.
 *
 * Three separate refusals, and each is load-bearing:
 *
 *   1. the caller must be authorized for THAT revision (above);
 *   2. the artifact must be pinned by that exact revision — owning the bytes is
 *      not enough, because the retained revision is what the caller was
 *      authorized against;
 *   3. the artifact's kind must be on the lane's allowlist — which is what
 *      keeps the private recipe JSON and the repair checkpoints out of every
 *      user-visible response, without anybody having to remember to exclude
 *      them.
 */
export async function authorizeScene3DArtifact(
  actorId: string,
  revisionId: string,
  artifactId: string,
  lane: Scene3DReadLane,
): Promise<Scene3DArtifactAuthorization> {
  if (!isScene3DId(artifactId)) return { ok: false, reason: "not-found" }

  const authorized = await authorizeScene3DRevision(actorId, revisionId, lane)
  if (!authorized.ok) return authorized

  const artifact = await loadScene3DPinnedArtifact(
    revisionId,
    artifactId,
    authorized.revision.userId,
  )
  if (!artifact) return { ok: false, reason: "not-found" }
  if (!scene3DIsReadable(artifact, lane)) return { ok: false, reason: "not-found" }
  return { ok: true, revision: authorized.revision, artifact }
}

/**
 * Is this artifact servable on this lane?
 *
 * Both columns are checked, not one. `kind` is the allowlist; `usage` is the
 * column a pin could in principle carry a different value in, and a
 * `source-json` pinned as `playback` must not become readable because one of
 * the two agreed with the lane.
 */
export function scene3DIsReadable(
  artifact: { kind: Scene3DPinnedArtifact["kind"]; usage: Scene3DPinnedArtifact["usage"] },
  lane: Scene3DReadLane,
): boolean {
  if (!scene3DLaneKinds(lane).includes(artifact.kind)) return false
  return SCENE3D_ARTIFACT_KIND_USAGE[artifact.kind] === artifact.usage
}
