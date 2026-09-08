import { Scene3DArtifactError, type Scene3DArtifactKind } from "./types.js"

/**
 * Where an artifact's bytes live — decided here, never by the caller.
 *
 * An upload capability is issued for exactly one of these keys, and
 * publication re-derives the key from `(userId, revisionId, artifactId)` and
 * refuses anything else. The three inputs are checked to be UUIDs before they
 * are concatenated, so no path segment can be smuggled through.
 *
 * Owner first so a per-tenant lifecycle rule has a prefix; revision second so
 * one revision's bytes are one listing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The prefix every Scene3D object shares. Exported for lifecycle rules. */
export const SCENE3D_OBJECT_PREFIX = "scene3d"

const KIND_EXTENSION: Readonly<Record<Scene3DArtifactKind, string>> = {
  glb: "glb",
  "camera-track-json": "camera.json",
  poster: "png",
  "validation-report": "validation.json",
  "blend-source": "blend",
  "source-json": "source.json",
  "build-manifest": "build.json",
  "input-glb": "input.glb",
}

export function isScene3DId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

function requireId(label: string, value: string): string {
  if (!isScene3DId(value)) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", `${label} must be a UUID`)
  }
  return value.toLowerCase()
}

export function scene3DArtifactObjectKey(
  userId: string,
  revisionId: string,
  artifactId: string,
  kind: Scene3DArtifactKind,
): string {
  const extension = KIND_EXTENSION[kind]
  if (!extension) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", `unknown artifact kind "${kind}"`)
  }
  return [
    SCENE3D_OBJECT_PREFIX,
    requireId("userId", userId),
    requireId("revisionId", revisionId),
    `${requireId("artifactId", artifactId)}.${extension}`,
  ].join("/")
}

/**
 * Accept a caller's key only when it is the key we would have chosen.
 *
 * Equality, not a prefix: "starts with the owner's prefix" would still let a
 * publication overwrite another of that owner's revisions.
 */
export function assertScene3DArtifactObjectKey(
  claimed: string | undefined,
  userId: string,
  revisionId: string,
  artifactId: string,
  kind: Scene3DArtifactKind,
): string {
  const derived = scene3DArtifactObjectKey(userId, revisionId, artifactId, kind)
  if (claimed !== undefined && claimed !== derived) {
    throw new Scene3DArtifactError(
      "SCENE_ASSET_INVALID",
      `artifact ${artifactId} was uploaded to an object key this platform did not grant`,
    )
  }
  return derived
}
