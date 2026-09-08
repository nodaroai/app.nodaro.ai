/**
 * The vocabulary of the Scene3D artifact store.
 *
 * One idea holds this module together: an artifact is **bytes with an owner, a
 * digest and a length**, and nothing else. It has no notion of what a scene
 * recipe is, how a camera rail is solved or what a repair pass costs — that is
 * the private engine's business. Keeping this file content-free is what lets
 * the store live in the public app while the authoring engine stays private.
 *
 * The kinds and usages below mirror the CHECK constraints in migrations 389 and 401
 * exactly. They are duplicated on purpose: the database refuses a bad row and
 * TypeScript refuses a bad call, and the pair of them means a typo cannot
 * reach either side alone. `scene3d-artifacts.behavior.sql` pins the SQL half.
 */

/** Every kind of byte the store holds. A superset of the manifest's asset
 *  kinds: `source-json` is the private recipe, which no manifest may name. */
export const SCENE3D_ARTIFACT_KINDS = [
  "glb",
  "camera-track-json",
  "poster",
  "validation-report",
  "blend-source",
  "source-json",
  "build-manifest",
  "input-glb",
] as const
export type Scene3DArtifactKind = (typeof SCENE3D_ARTIFACT_KINDS)[number]

/** Why a revision pins an artifact. */
export const SCENE3D_ARTIFACT_USAGES = [
  "playback",
  "poster",
  "validation",
  "source",
  "checkpoint",
] as const
export type Scene3DArtifactUsage = (typeof SCENE3D_ARTIFACT_USAGES)[number]

/**
 * kind → usage, one-to-one and total.
 *
 * A map rather than two free enums, because the interesting question is never
 * "is this usage spelled right" but "can these bytes be reached from the
 * playback lane" — and a `source-json` pinned as `playback` would answer yes
 * to a check that only looked at one column. Derived, so a new kind must
 * declare its lane here before it can be published at all.
 */
export const SCENE3D_ARTIFACT_KIND_USAGE: Readonly<Record<Scene3DArtifactKind, Scene3DArtifactUsage>> = {
  glb: "playback",
  "camera-track-json": "playback",
  poster: "poster",
  "validation-report": "validation",
  "blend-source": "source",
  "source-json": "checkpoint",
  "build-manifest": "checkpoint",
  "input-glb": "checkpoint",
}

/**
 * The two user-visible read lanes, as ALLOWLISTS.
 *
 * Allowlists and not "everything except the private kinds": a deny-list is
 * open by default, so the next kind somebody adds is served to users until
 * somebody remembers to deny it. Here the next kind is unreachable until it is
 * deliberately listed, and `read-lanes.test.ts` iterates every enum member to
 * prove the private ones are in neither list.
 */
export const SCENE3D_PLAYBACK_KINDS: readonly Scene3DArtifactKind[] = [
  "glb",
  "camera-track-json",
  "poster",
  "validation-report",
]
export const SCENE3D_SOURCE_KINDS: readonly Scene3DArtifactKind[] = ["blend-source"]

export type Scene3DReadLane = "playback" | "source"

export function scene3DLaneKinds(lane: Scene3DReadLane): readonly Scene3DArtifactKind[] {
  return lane === "source" ? SCENE3D_SOURCE_KINDS : SCENE3D_PLAYBACK_KINDS
}

/**
 * What a browser is told a byte stream is.
 *
 * A pure function of `kind`, which is only possible because receipt REFUSES a
 * poster that is not a PNG (see `receipt.ts`). The alternative — storing a
 * caller-supplied content type — is how a "poster" becomes `text/html` and the
 * media host becomes an XSS origin.
 */
export const SCENE3D_ARTIFACT_CONTENT_TYPES: Readonly<Record<Scene3DArtifactKind, string>> = {
  glb: "model/gltf-binary",
  "camera-track-json": "application/json",
  poster: "image/png",
  "validation-report": "application/json",
  "blend-source": "application/octet-stream",
  "source-json": "application/json",
  "build-manifest": "application/json",
  "input-glb": "model/gltf-binary",
}

/** A stored artifact, as the store hands it around. Never serialized to a
 *  user: `bucket` and `objectKey` stay on this side of the API. */
export interface Scene3DArtifactRecord {
  artifactId: string
  userId: string
  kind: Scene3DArtifactKind
  bucket: string
  objectKey: string
  sha256: string
  byteLength: number
  etag: string
  expiresAt: string | null
  createdAt: string
}

/** What a revision pins, and why. */
export interface Scene3DPinnedArtifact extends Scene3DArtifactRecord {
  usage: Scene3DArtifactUsage
}

export interface Scene3DRevisionRecord {
  revisionId: string
  userId: string
  workflowId: string | null
  sourceJobId: string | null
  parentRevisionId: string | null
  planSha256: string
  createdAt: string
  plan: unknown
}

/** The manifest descriptor a user is allowed to see. Opaque ids and digests
 *  only — no bucket, no key, no URL, no expiry token. */
export interface Scene3DAssetDescriptor {
  assetId: string
  kind: Scene3DArtifactKind
  usage: Scene3DArtifactUsage
  byteLength: number
  sha256: string
}

/** What the platform learned by reading the uploaded object back. */
export interface Scene3DUploadReceipt {
  sha256: string
  byteLength: number
  etag: string
  receivedAt: string | null
}

/**
 * A reservation made before an upload capability is issued. It names the exact
 * bytes a build may write, and it is what makes an upload that never published
 * collectable instead of orphaned.
 */
export interface Scene3DUploadIntent {
  artifactId: string
  userId: string
  jobId: string | null
  revisionId: string
  kind: Scene3DArtifactKind
  bucket: string
  objectKey: string
  /** When the upload capability stops working. */
  expiresAt: string
  /** Expiry plus grace: the earliest moment the bytes may be swept. */
  collectAfter: string
  receipt: Scene3DUploadReceipt | null
}

/** One artifact a publication is asking the store to accept. */
export interface Scene3DArtifactPublishInput {
  artifactId: string
  kind: Scene3DArtifactKind
  sha256: string
  byteLength: number
  /** Optional. When present it must equal the derived key exactly. */
  objectKey?: string
  expiresAt?: string | null
  /** Pin bytes an earlier revision of the SAME owner already published. */
  reuseFromRevisionId?: string | null
}

export interface Scene3DPublishInput {
  revisionId: string
  userId: string
  workflowId?: string | null
  sourceJobId?: string | null
  parentRevisionId?: string | null
  /** `Scene3DPlanV1 | Scene3DPlanV2`, unparsed — publication validates it. */
  plan: unknown
  artifacts: Scene3DArtifactPublishInput[]
  /** Refuse any new artifact that no reservation covers. Off by default so a
   *  deployment can adopt reservations before it depends on them. */
  requireIntents?: boolean
}

export interface Scene3DPublishResult {
  revisionId: string
  status: "created" | "unchanged"
  artifactIds: string[]
}

/**
 * Stable failure codes.
 *
 * Codes rather than HTTP statuses, so a worker, a route and an MCP tool can
 * all fail the same way about the same thing.
 */
export type Scene3DArtifactErrorCode =
  | "SCENE_ASSET_INVALID"
  | "SCENE_ASSET_MISSING"
  /** The artifact id's bytes are being, or have been, collected. It can never
   *  be reserved or published again — mint a new id. */
  | "SCENE_ASSET_RETIRED"
  | "SCENE_REVISION_CONFLICT"
  | "SCENE_PLAN_INVALID"
  | "SCENE_JOB_INVALID"
  | "SCENE_STORAGE_UNCONFIGURED"
  | "SCENE_STORAGE_FAILED"

export class Scene3DArtifactError extends Error {
  readonly code: Scene3DArtifactErrorCode
  readonly detail?: string

  constructor(code: Scene3DArtifactErrorCode, message: string, detail?: string) {
    super(message)
    this.name = "Scene3DArtifactError"
    this.code = code
    this.detail = detail
  }
}

export function isScene3DArtifactError(value: unknown): value is Scene3DArtifactError {
  return value instanceof Scene3DArtifactError
}
