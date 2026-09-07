/**
 * Asset readiness for a v2 plan.
 *
 * "Assets must be fully loaded and validated before Remotion releases
 * `delayRender`." So this is an all-or-nothing gate: it returns a fully
 * resolved, fully validated bundle, or it throws. There is no partial result
 * and no "render what we have" — that is exactly how a placeholder MP4 gets
 * encoded and billed.
 *
 * Order matters and is deliberate:
 *  1. the CONTRACT's schema (`scene3DPlanV2Schema`) — the renderer receives
 *     `inputProps`, which is plain JSON that nothing has validated yet;
 *  2. the contract's ADMISSION gate (declared bytes and counts) — before a
 *     single byte is fetched;
 *  3. camera sidecar (small, and a mismatch invalidates everything else);
 *  4. GLBs — for each: verify digest → bounded pre-inspection → only then hand
 *     the bytes to `GLTFLoader`;
 *  5. the contract's NORMALIZATION gate on what actually decoded.
 *
 * Every step takes the same `AbortSignal`, because React StrictMode invokes
 * effects twice and a plan can change mid-flight; without it the first load
 * would finish into a handle the second has already replaced.
 */
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import {
  SCENE3D_RENDERER_ASSET_KINDS,
  scene3DPlanV2Schema,
  scene3DV2AdmissionIssues,
  scene3DV2NormalizationIssues,
  type Scene3DNormalizedAssetStats,
} from "@nodaro/shared"
import { resolveVerifiedAsset, type Scene3DAssetResolver } from "./asset-resolver"
import { decodeScene3DCameraTrack, type Scene3DCameraTrackV1 } from "./camera-track"
import { Scene3DError, check, fail, type Scene3DReadinessWarning } from "./errors"
import { inspectGlb, type GlbInspection } from "./glb-inspect"
import { buildOverlayIndex, type Scene3DOverlayIndex } from "./overlays"
import type { Scene3DAssetRef, Scene3DEntityV2, Scene3DPlanV2 } from "./plan-shape"
import { buildShotTimeline, type Scene3DShotTimeline } from "./shots"

export interface LoadedGlbAsset {
  readonly assetId: string
  readonly inspection: GlbInspection
  readonly scene: THREE.Group
  readonly clips: readonly THREE.AnimationClip[]
}

export interface Scene3DLoadedScene {
  readonly plan: Scene3DPlanV2
  readonly cameraTrack: Scene3DCameraTrackV1
  readonly shots: Scene3DShotTimeline
  readonly overlays: Scene3DOverlayIndex
  readonly glbById: ReadonlyMap<string, LoadedGlbAsset>
  readonly warnings: readonly Scene3DReadinessWarning[]
}

export interface Scene3DLoadOptions {
  readonly resolver?: Scene3DAssetResolver
  readonly signal: AbortSignal
}

interface Issue {
  path: (string | number)[]
  message: string
}

function describe(issues: readonly Issue[]): string {
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
}

/**
 * Everything checkable without bytes: the contract's own schema, then its
 * admission gate, then the renderer's frame→shot index and overlay index.
 *
 * Returns the PARSED plan — the schema has no defaults, so it deep-equals the
 * input, but parsing is what proves the JSON that arrived in `inputProps` is
 * actually a v2 manifest rather than something shaped like one.
 */
export function validateScene3DPlanV2Shape(plan: Scene3DPlanV2): {
  plan: Scene3DPlanV2
  assets: Map<string, Scene3DAssetRef>
  shots: Scene3DShotTimeline
  overlays: Scene3DOverlayIndex
} {
  const parsed = scene3DPlanV2Schema.safeParse(plan)
  if (!parsed.success) {
    return fail(
      "SCENE_PLAN_INVALID",
      `plan rejected by the Scene3D v2 contract: ${describe(
        parsed.error.issues.map((issue) => ({ path: [...issue.path] as (string | number)[], message: issue.message })),
      )}`,
    )
  }
  const value = parsed.data as Scene3DPlanV2

  const admission = scene3DV2AdmissionIssues(value)
  if (admission.length > 0) {
    return fail("SCENE_RESOURCE_LIMIT", describe(admission))
  }

  const assets = new Map<string, Scene3DAssetRef>()
  for (const ref of value.assets) assets.set(ref.assetId, ref)

  return {
    plan: value,
    assets,
    shots: buildShotTimeline(value.shots, value.durationInFrames),
    overlays: buildOverlayIndex(value),
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Scene3D asset load aborted", "AbortError")
}

/** `GLTFLoader.parse` is callback-based; this is the promise wrapper. */
function parseGlb(
  bytes: ArrayBuffer,
  assetId: string,
): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    // Empty resource path: nothing in an allowed GLB may reference an external
    // file, and the pre-inspection has already rejected every `uri`.
    loader.parse(
      bytes,
      "",
      (gltf) => resolve({ scene: gltf.scene as THREE.Group, animations: gltf.animations }),
      (error) =>
        reject(
          new Scene3DError(
            "SCENE_ASSET_INVALID",
            `GLTFLoader rejected the asset: ${(error as { message?: string })?.message ?? String(error)}`,
            assetId,
          ),
        ),
    )
  })
}

/**
 * Fetch, verify and decode everything a v2 plan needs.
 *
 * Assets load SEQUENTIALLY on purpose: the mesh-node and triangle budgets are
 * aggregate, so an over-budget scene must be refused after the file that
 * crossed the line rather than after all of them have been decoded in parallel.
 */
export async function loadScene3DV2(
  input: Scene3DPlanV2,
  { resolver, signal }: Scene3DLoadOptions,
): Promise<Scene3DLoadedScene> {
  const warnings: Scene3DReadinessWarning[] = []
  const { plan, assets, shots, overlays } = validateScene3DPlanV2Shape(input)
  throwIfAborted(signal)

  const stats: Scene3DNormalizedAssetStats[] = []

  const cameraRef = assets.get(plan.cameraTrackAssetId) as Scene3DAssetRef
  const cameraBytes = await resolveVerifiedAsset(resolver, cameraRef, signal)
  throwIfAborted(signal)
  const cameraTrack = decodeScene3DCameraTrack(cameraBytes, plan, cameraRef.assetId)
  stats.push({
    assetId: cameraRef.assetId,
    kind: cameraRef.kind,
    byteLength: cameraBytes.byteLength,
  })

  if (overlays.needsCameraTarget) {
    // A re-aiming override needs a target on every sample it touches. Checked
    // once here rather than mid-render, where it would abort a paid job.
    for (const [shotId, override] of overlays.cameraShots) {
      if (!override.targetOffset) continue
      const shot = plan.shots.find((candidate) => candidate.id === shotId)
      if (!shot) continue
      for (let frame = shot.startFrame; frame < shot.endFrameExclusive; frame++) {
        check(
          cameraTrack.samples[frame]?.target !== undefined,
          "SCENE_OVERRIDE_INVALID",
          `camera override re-aims this shot, but sample ${frame} carries no target`,
          shotId,
        )
      }
    }
  }

  const neededGlbIds = new Set<string>()
  for (const entity of plan.objects) {
    if (entity.visual.kind === "asset") neededGlbIds.add(entity.visual.assetId)
  }

  const glbById = new Map<string, LoadedGlbAsset>()
  const budget = { meshNodes: 0, triangles: 0 }
  for (const assetId of neededGlbIds) {
    throwIfAborted(signal)
    const ref = assets.get(assetId)
    check(!!ref, "SCENE_PLAN_INVALID", "entity binds an asset that is not declared", assetId)
    check(
      SCENE3D_RENDERER_ASSET_KINDS.includes(ref.kind),
      "SCENE_ASSET_INVALID",
      `asset kind "${ref.kind}" is not fetchable by the renderer`,
      assetId,
    )
    const bytes = await resolveVerifiedAsset(resolver, ref, signal)
    throwIfAborted(signal)
    // Bounded pre-inspection BEFORE the parser allocates anything.
    const inspection = inspectGlb(bytes, assetId, budget)
    const { scene, animations } = await parseGlb(bytes, assetId)
    throwIfAborted(signal)
    glbById.set(assetId, { assetId, inspection, scene, clips: animations })
    stats.push({
      assetId,
      kind: ref.kind,
      byteLength: bytes.byteLength,
      meshNodes: inspection.meshNodeCount,
      triangles: inspection.triangleCount,
      maxNodeDepth: inspection.maxDepth,
    })
  }

  // The contract's post-decode gate: what arrived must match what the manifest
  // promised, and the assembled scene must fit the aggregate budget.
  const normalization = scene3DV2NormalizationIssues(plan, stats)
  if (normalization.length > 0) fail("SCENE_RESOURCE_LIMIT", describe(normalization))

  bindEntitiesToAssets(plan, glbById, warnings)

  return { plan, cameraTrack, shots, overlays, glbById, warnings }
}

/**
 * Cross-check every entity's declared binding against what the files actually
 * contain, BEFORE anything is drawn. A missing entity root is the "missing
 * mesh" case the contract requires to fail the render.
 */
function bindEntitiesToAssets(
  plan: Scene3DPlanV2,
  glbById: ReadonlyMap<string, LoadedGlbAsset>,
  warnings: Scene3DReadinessWarning[],
): void {
  for (const entity of plan.objects) {
    const visual = entity.visual
    if (visual.kind !== "asset") continue
    const asset = glbById.get(visual.assetId)
    if (!asset) fail("SCENE_ASSET_UNAVAILABLE", "asset was not loaded", visual.assetId)

    // `rootNodeId` addresses the exported node by NAME; the extras id on that
    // node CONFIRMS ownership. Both are required: without the name lookup a
    // root could not be told apart from the meshes it owns (they share the id),
    // and without the id check entity "box" could bind the floor's root.
    const root = asset.inspection.entityRootsByNodeName.get(visual.rootNodeId)
    check(
      !!root,
      "SCENE_ASSET_BINDING",
      `asset "${visual.assetId}" has no semantic root node named "${visual.rootNodeId}" (roots: ${[...asset.inspection.entityRootsByNodeName.keys()].join(", ") || "none"})`,
      entity.id,
    )
    check(
      root.entityId === entity.id,
      "SCENE_ASSET_BINDING",
      `root node "${visual.rootNodeId}" is owned by entity "${root.entityId}", not by "${entity.id}"`,
      entity.id,
    )
    check(
      root.meshNodeCount > 0,
      "SCENE_ASSET_BINDING",
      `entity root "${visual.rootNodeId}" contains no mesh`,
      entity.id,
    )

    // A track under this entity that nothing will ever play. The whole-scene
    // clip a Blender export emits carries tracks for EVERY entity, so an
    // entity that forgot its `animation` binding sits frozen while its
    // siblings move — invisible in a finished MP4, obvious here.
    if (!visual.animation) {
      const animated = root.subtreeNodeNames.filter((name) =>
        asset.inspection.animatedNodeNames.has(name),
      )
      if (animated.length > 0) {
        warnings.push({
          code: "SCENE_ANIMATION_UNBOUND",
          message: `the asset animates ${animated.length} node(s) under this entity (${animated.slice(0, 3).join(", ")}) but the entity declares no animation binding, so it will not move`,
          subject: entity.id,
        })
      }
    }

    for (const binding of entity.materialBindings ?? []) {
      check(
        root.materialNames.includes(binding.materialName),
        "SCENE_ASSET_BINDING",
        `material binding for role "${binding.role}" names material "${binding.materialName}", which is not in this entity's asset root`,
        entity.id,
      )
    }

    // The window itself is the contract's business; whether the FILE actually
    // contains the clip is only knowable here, with the bytes in hand.
    if (visual.animation) {
      check(
        asset.inspection.animationNames.includes(visual.animation.clipName),
        "SCENE_ASSET_BINDING",
        `animation clip "${visual.animation.clipName}" is not in asset "${visual.assetId}" (available: ${asset.inspection.animationNames.join(", ") || "none"})`,
        entity.id,
      )
    }

    // The manifest transform on an ASSET entity is an informational frame-0
    // snapshot; the GLB node transform is authoritative. Applying both is the
    // double-transform bug, so the builder applies only the node's — say so
    // when the two visibly disagree rather than letting it look like a bug.
    if (root.hasStaticLocalTransform && hasNonIdentityTransform(entity)) {
      warnings.push({
        code: "SCENE_ENTITY_TRANSFORM_IGNORED",
        message:
          "this entity declares a base transform and its GLB root node carries one too; per the v2 contract the GLB node transform is authoritative and the manifest values are not applied",
        subject: entity.id,
      })
    }
  }
}

const EPS = 1e-6

function hasNonIdentityTransform(entity: Scene3DEntityV2): boolean {
  if (entity.position?.some((v) => Math.abs(v) > EPS)) return true
  if (entity.rotation?.some((v) => Math.abs(v) > EPS)) return true
  if (entity.scale?.some((v) => Math.abs(v - 1) > EPS)) return true
  return false
}
