import type { Scene3DArtifactPublishInput, Scene3DPinnedArtifact } from "./types.js"

export const SCENE3D_DELIVERY_KINDS = ["poster", "validation-report", "shot-still"] as const
export type Scene3DDeliveryKind = (typeof SCENE3D_DELIVERY_KINDS)[number]
/**
 * `refused-authoring` is the one source that is not a scene.
 *
 * The other two deliver a composition somebody can open: a retained revision, or a Basic
 * export's own job output. A Pro run whose recipe the compiler refused on every pass has
 * neither — a v2 manifest needs at least one asset and one shot, and the plan is the
 * compiler's output, so nothing was ever published to point at. What the run DOES have is
 * the planner's final recipe and the compiler's reasons for refusing it, and this kind is how
 * those reach their owner instead of being dropped.
 */
export type Scene3DDeliverySourceKind = "retained-revision" | "job-output" | "refused-authoring"
export type Scene3DDeliveryMode = "render-only" | "authored"

export interface Scene3DDeliveryRecord {
  jobId: string
  userId: string
  workflowId: string | null
  sourceKind: Scene3DDeliverySourceKind
  /** On `refused-authoring` this is the attempt identity the artifacts were written under —
   *  a namespace, not a published revision. The read route reports no scene for that kind. */
  sourceRevisionId: string
  /** Null on `refused-authoring` alone: there is no plan, so there is no plan digest. */
  sourcePlanSha256: string | null
  sourceContentHash: string | null
  sourceJobId: string | null
  sourceOwnerId: string
  sourceWorkflowId: string | null
  mode: Scene3DDeliveryMode
  createdAt: string
}

export interface Scene3DDeliveryArtifact extends Scene3DPinnedArtifact {
  viaRevisionId: string | null
  /** Set on `shot-still` pins only, and always set on those. */
  shotIndex: number | null
  frame: number | null
  width: number | null
  height: number | null
}

export interface Scene3DDeliveryPublishInput {
  jobId: string
  userId: string
  revisionId: string
  source: { kind: Scene3DDeliverySourceKind; jobId?: string }
  mode: Scene3DDeliveryMode
  plan: unknown
  artifacts: Array<
    Omit<Scene3DArtifactPublishInput, "kind" | "expiresAt"> & {
      kind: Scene3DDeliveryKind
      /** Required on a `shot-still`, refused on anything else. */
      shotIndex?: number
      frame?: number
      /** Optional: the composition's own frame size when the producer omits it. */
      width?: number
      height?: number
    }
  >
}

/**
 * Publishing the evidence of authoring that never compiled.
 *
 * No plan and no poster, because neither exists. `revisionId` is the attempt identity the
 * report and recipe were reserved under, which is what binds them to this parent's upload
 * intents; no revision row is read, and none is required to exist.
 */
export interface Scene3DRefusedDeliveryPublishInput {
  jobId: string
  userId: string
  revisionId: string
  source: { kind: "refused-authoring" }
  mode: "authored"
  artifacts: Array<
    Omit<Scene3DArtifactPublishInput, "kind" | "expiresAt"> & {
      /** Exactly one report; the recipe is optional and never user-readable. */
      kind: "validation-report" | "source-json"
    }
  >
}

export interface Scene3DDeliveryPublishResult {
  deliveryId: string
  revisionId: string
  status: "created" | "unchanged"
  artifactIds: string[]
}
