/**
 * Scene3D v2 resource admission and revision identity.
 *
 * Two gates and one hash, all of which have to agree across the builder, the
 * platform route and the renderer — so they live in one published place instead
 * of being re-derived three times.
 *
 * **Pre-allocation gate** (`scene3DV2AdmissionIssues`). Everything checkable
 * from the manifest alone, BEFORE a byte is fetched or a decoder is handed
 * anything: declared asset sizes, counts, timeline length, hierarchy depth, and
 * the decoded size of the manifest itself. A limit enforced after the download
 * is not a limit.
 *
 * **Post-decode gate** (`scene3DV2NormalizationIssues`). What only the actual
 * bytes can answer: real length versus declared, digest versus declared,
 * triangles, mesh nodes, node depth, image dimensions. A 2 MiB GLB can decode
 * to a hundred million triangles, so compression never waives a geometry
 * budget.
 *
 * **Content hash.** The canonical form of a revision, which is what makes
 * "these two revisions are the same scene" a decidable question — for
 * content-addressed caching, and for asserting after a rebuild that the entities
 * the user locked really did come back unchanged.
 */
import {
  SCENE3D_RENDERER_ASSET_KINDS,
  SCENE3D_V2_LIMITS,
  scene3DJsonByteLength,
  scene3DZodIssues,
  type Scene3DAssetKind,
  type Scene3DEntityV2,
  type Scene3DParseResult,
  type Scene3DPlanV2,
} from "./scene3d-v2.js"
import { scene3DPlanV2Schema } from "./scene3d-v2-plan.js"
import type { Scene3DSemanticIssue } from "./scene3d.js"

type Issue = Scene3DSemanticIssue

// ---------------------------------------------------------------------------
// Declared usage (pre-allocation)
// ---------------------------------------------------------------------------

export interface Scene3DV2ResourceUsage {
  entities: number
  assets: number
  shots: number
  overrides: number
  references: number
  frames: number
  durationSeconds: number
  /** Deepest entity parent chain, 1 for a flat scene. */
  hierarchyDepth: number
  /** Declared bytes of everything the browser downloads. */
  rendererAssetBytes: number
  /** Declared bytes of the camera sidecar. */
  cameraTrackBytes: number
  /** Declared bytes of the retained native source, which the browser never sees. */
  blendSourceBytes: number
}

/** Deepest parent chain, counting the entity itself. Bounded by the entity
 *  count even on a cyclic plan, so it is safe to call before validation. */
export function scene3DV2HierarchyDepth(entities: readonly Scene3DEntityV2[]): number {
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  let deepest = 0
  for (const entity of entities) {
    let depth = 1
    let cursor = entity
    const seen = new Set<string>([entity.id])
    while (cursor.parentId !== undefined) {
      const parent = byId.get(cursor.parentId)
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id)
      cursor = parent
      depth += 1
    }
    if (depth > deepest) deepest = depth
  }
  return deepest
}

/** What this manifest CLAIMS it will cost. Also the shape a capabilities or
 *  quote surface displays — it is derived, never authored. */
export function scene3DV2ResourceUsage(plan: Scene3DPlanV2): Scene3DV2ResourceUsage {
  let rendererAssetBytes = 0
  let cameraTrackBytes = 0
  let blendSourceBytes = 0
  for (const asset of plan.assets) {
    if (SCENE3D_RENDERER_ASSET_KINDS.includes(asset.kind)) rendererAssetBytes += asset.byteLength
    if (asset.kind === "camera-track-json") cameraTrackBytes += asset.byteLength
    if (asset.kind === "blend-source") blendSourceBytes += asset.byteLength
  }
  return {
    entities: plan.objects.length,
    assets: plan.assets.length,
    shots: plan.shots.length,
    overrides: plan.overrides?.length ?? 0,
    references: plan.references?.length ?? 0,
    frames: plan.durationInFrames,
    durationSeconds: plan.durationInFrames / plan.fps,
    hierarchyDepth: scene3DV2HierarchyDepth(plan.objects),
    rendererAssetBytes,
    cameraTrackBytes,
    blendSourceBytes,
  }
}

/**
 * The pre-allocation gate. `manifestBytes` is the DECODED size of the manifest
 * as it arrived — pass it when admitting a downloaded manifest, omit it when
 * the plan is already in memory.
 *
 * Most of these are also enforced by `scene3DPlanV2Schema`; this function is
 * what a caller runs when it wants the budget answer without re-parsing, and
 * what makes the ceilings quotable in one place by capabilities and docs.
 */
export function scene3DV2AdmissionIssues(plan: Scene3DPlanV2, manifestBytes?: number): Issue[] {
  const issues: Issue[] = []
  const usage = scene3DV2ResourceUsage(plan)
  const limits = SCENE3D_V2_LIMITS

  if (manifestBytes !== undefined && manifestBytes > limits.maxManifestBytes) {
    issues.push({
      path: [],
      message: `manifest is ${manifestBytes} bytes; the limit is ${limits.maxManifestBytes}`,
    })
  }
  if (usage.frames > limits.maxDurationInFrames) {
    issues.push({
      path: ["durationInFrames"],
      message: `scene is ${usage.frames} frames; the limit is ${limits.maxDurationInFrames}`,
    })
  }
  if (usage.durationSeconds > limits.maxDurationSeconds) {
    issues.push({
      path: ["durationInFrames"],
      message: `scene is ${usage.durationSeconds.toFixed(2)}s; the limit is ${limits.maxDurationSeconds}s`,
    })
  }
  if (usage.entities > limits.maxEntities) {
    issues.push({ path: ["objects"], message: `${usage.entities} entities; the limit is ${limits.maxEntities}` })
  }
  if (usage.shots > limits.maxShots) {
    issues.push({ path: ["shots"], message: `${usage.shots} shots; the limit is ${limits.maxShots}` })
  }
  if (usage.hierarchyDepth > limits.maxHierarchyDepth) {
    issues.push({
      path: ["objects"],
      message: `hierarchy is ${usage.hierarchyDepth} deep; the limit is ${limits.maxHierarchyDepth}`,
    })
  }
  if (usage.rendererAssetBytes > limits.maxRendererAssetBytes) {
    issues.push({
      path: ["assets"],
      message: `downloaded scene assets total ${usage.rendererAssetBytes} bytes; the limit is ${limits.maxRendererAssetBytes}`,
    })
  }
  if (usage.cameraTrackBytes > limits.maxCameraTrackBytes) {
    issues.push({
      path: ["assets"],
      message: `camera track data totals ${usage.cameraTrackBytes} bytes; the limit is ${limits.maxCameraTrackBytes}`,
    })
  }
  return issues
}

// ---------------------------------------------------------------------------
// Post-decode normalization
// ---------------------------------------------------------------------------

/**
 * What the normalizer measured on the ACTUAL bytes of one asset. Optional
 * fields are "not applicable to this kind" — a poster has image dimensions and
 * no triangles; a GLB is the other way round.
 */
export interface Scene3DNormalizedAssetStats {
  assetId: string
  kind: Scene3DAssetKind
  /** Decoded length, after any transport compression. */
  byteLength: number
  /** Digest of the decoded bytes, lowercase hex, when computed. */
  sha256?: string
  meshNodes?: number
  triangles?: number
  /** Deepest node chain inside the asset's own scene graph. */
  maxNodeDepth?: number
  imageWidth?: number
  imageHeight?: number
}

/**
 * The post-decode gate: does what arrived match what the manifest promised, and
 * does the resolved geometry fit the budget?
 *
 * Mesh nodes and triangles are summed ACROSS assets — the ceiling is on the
 * scene the renderer assembles, not on any single file.
 */
export function scene3DV2NormalizationIssues(
  plan: Scene3DPlanV2,
  stats: readonly Scene3DNormalizedAssetStats[],
): Issue[] {
  const issues: Issue[] = []
  const limits = SCENE3D_V2_LIMITS
  const declared = new Map(plan.assets.map((asset) => [asset.assetId, asset]))

  let meshNodes = 0
  let triangles = 0
  let rendererBytes = 0

  stats.forEach((stat, index) => {
    const at = (...rest: (string | number)[]) => [index, ...rest]
    const asset = declared.get(stat.assetId)
    if (!asset) {
      issues.push({ path: at("assetId"), message: `asset "${stat.assetId}" is not declared in the manifest` })
      return
    }
    if (stat.kind !== asset.kind) {
      issues.push({
        path: at("kind"),
        message: `asset "${stat.assetId}" decoded as "${stat.kind}" but the manifest declares "${asset.kind}"`,
      })
    }
    if (stat.byteLength !== asset.byteLength) {
      issues.push({
        path: at("byteLength"),
        message: `asset "${stat.assetId}" is ${stat.byteLength} bytes; the manifest declares ${asset.byteLength}`,
      })
    }
    if (stat.sha256 !== undefined && stat.sha256 !== asset.sha256) {
      issues.push({
        path: at("sha256"),
        message: `asset "${stat.assetId}" digest does not match the manifest`,
      })
    }

    if (SCENE3D_RENDERER_ASSET_KINDS.includes(stat.kind)) rendererBytes += stat.byteLength
    if (stat.kind === "camera-track-json" && stat.byteLength > limits.maxCameraTrackBytes) {
      issues.push({
        path: at("byteLength"),
        message: `camera track "${stat.assetId}" decoded to ${stat.byteLength} bytes; the limit is ${limits.maxCameraTrackBytes}`,
      })
    }

    meshNodes += stat.meshNodes ?? 0
    triangles += stat.triangles ?? 0

    if (stat.maxNodeDepth !== undefined && stat.maxNodeDepth > limits.maxHierarchyDepth) {
      issues.push({
        path: at("maxNodeDepth"),
        message: `asset "${stat.assetId}" nests ${stat.maxNodeDepth} levels; the limit is ${limits.maxHierarchyDepth}`,
      })
    }

    for (const [field, value] of [
      ["imageWidth", stat.imageWidth],
      ["imageHeight", stat.imageHeight],
    ] as const) {
      if (value === undefined) continue
      if (!Number.isInteger(value) || value < limits.minPosterDimensionPx || value > limits.maxPosterDimensionPx) {
        issues.push({
          path: at(field),
          message: `asset "${stat.assetId}" ${field} is ${value}; it must be an integer between ${limits.minPosterDimensionPx} and ${limits.maxPosterDimensionPx}`,
        })
      }
    }
  })

  if (meshNodes > limits.maxMeshNodes) {
    issues.push({ path: [], message: `resolved assets contain ${meshNodes} mesh nodes; the limit is ${limits.maxMeshNodes}` })
  }
  if (triangles > limits.maxTriangles) {
    issues.push({ path: [], message: `resolved assets contain ${triangles} triangles; the limit is ${limits.maxTriangles}` })
  }
  if (rendererBytes > limits.maxRendererAssetBytes) {
    issues.push({
      path: [],
      message: `downloaded scene assets decoded to ${rendererBytes} bytes; the limit is ${limits.maxRendererAssetBytes}`,
    })
  }

  return issues
}

// ---------------------------------------------------------------------------
// Manifest admission
// ---------------------------------------------------------------------------

/** Size-gate on the bytes, then parse, then the full v2 schema. Refuses an
 *  oversized manifest before `JSON.parse` allocates it. */
export function parseScene3DPlanV2Json(text: string): Scene3DParseResult<Scene3DPlanV2> {
  const bytes = scene3DJsonByteLength(text)
  if (bytes > SCENE3D_V2_LIMITS.maxManifestBytes) {
    return {
      ok: false,
      issues: [{ path: [], message: `manifest is ${bytes} bytes; the limit is ${SCENE3D_V2_LIMITS.maxManifestBytes}` }],
    }
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    return { ok: false, issues: [{ path: [], message: "manifest is not valid JSON" }] }
  }
  const parsed = scene3DPlanV2Schema.safeParse(decoded)
  if (!parsed.success) return { ok: false, issues: scene3DZodIssues(parsed.error) }
  return { ok: true, value: parsed.data as Scene3DPlanV2 }
}

// ---------------------------------------------------------------------------
// Canonical form and content hash
// ---------------------------------------------------------------------------

/**
 * Fields excluded from the canonical form.
 *
 * `revisionId`/`parentRevisionId` are IDENTITY, not content: two revisions with
 * the same scene must hash the same, or a content-addressed cache never hits
 * and "did the rebuild preserve the locked entities?" cannot be answered by
 * comparing hashes. `provenance.contentHash` is excluded because a value cannot
 * contain its own hash.
 *
 * Everything else is in — entities, anchors, material bindings, overrides, asset
 * digests, shots, lighting, provenance versions.
 */
export const SCENE3D_V2_CONTENT_HASH_EXCLUDED = ["revisionId", "parentRevisionId"] as const

function canonicalize(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot canonicalize a non-finite number")
    // -0 and 0 are the same scene; JSON.stringify disagrees.
    return JSON.stringify(value === 0 ? 0 : value)
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      const entry = record[key]
      if (entry === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalize(entry)}`)
    }
    return `{${parts.join(",")}}`
  }
  throw new Error(`cannot canonicalize ${typeof value}`)
}

/**
 * The exact bytes a revision's content hash is computed over: recursively
 * key-sorted JSON with the identity fields removed. Key order in the input
 * cannot change the result, so a manifest that survives a round-trip through a
 * database or a re-serialization still hashes the same.
 */
export function canonicalScene3DPlanV2Json(plan: Scene3DPlanV2): string {
  const { revisionId: _revisionId, parentRevisionId: _parentRevisionId, provenance, ...rest } = plan
  const { contentHash: _contentHash, ...provenanceRest } = provenance
  return canonicalize({ ...rest, provenance: provenanceRest })
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * SHA-256 of the canonical form, lowercase hex — the value that belongs in
 * `provenance.contentHash`. Uses WebCrypto, which the browser, Node 18+ and the
 * Remotion renderer all expose, so producer and consumer compute it the same
 * way.
 */
export async function computeScene3DPlanV2ContentHash(plan: Scene3DPlanV2): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (!subtle) throw new Error("WebCrypto SubtleCrypto is required to hash a Scene3D revision")
  const bytes = new TextEncoder().encode(canonicalScene3DPlanV2Json(plan))
  return toHex(await subtle.digest("SHA-256", bytes))
}

/** Does the manifest's declared `provenance.contentHash` match its content? */
export async function verifyScene3DPlanV2ContentHash(plan: Scene3DPlanV2): Promise<boolean> {
  return (await computeScene3DPlanV2ContentHash(plan)) === plan.provenance.contentHash
}
