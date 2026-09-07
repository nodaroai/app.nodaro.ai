/**
 * Plan / camera-track fixtures for the v2 renderer suite.
 *
 * Every plan built here is one the CONTRACT accepts (`scene3DPlanV2Schema` is
 * `.strict()` and the loader parses with it), so a contract change breaks these
 * first instead of letting the renderer suite stay green against a shape the
 * platform can never emit.
 *
 * Camera samples come from a real `THREE.PerspectiveCamera`, so the projection
 * matrices under test are the ones three actually produces rather than
 * hand-typed numbers that happen to satisfy the validator.
 */
import * as THREE from "three"
import type {
  Scene3DAssetRef,
  Scene3DAssetRole,
  Scene3DCameraTrackV1,
  Scene3DEntityV2,
  Scene3DOverride,
  Scene3DPlanV2,
  Scene3DShot,
} from "../plan-shape"
import { assetRefFor, jsonAssetBytes } from "./glb-fixtures"
import type { Scene3DAssetResolver } from "../asset-resolver"

const REVISION_ID = "22222222-2222-4222-8222-222222222222"
const CONTENT_HASH = "a".repeat(64)

export function perspectiveMatrix(
  fovDeg = 39.6,
  aspect = 1920 / 1080,
  near = 0.1,
  far = 1000,
): number[] {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, near, far)
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.toArray()
}

export function orthographicMatrix(): number[] {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.toArray()
}

export interface MakeCameraTrackOptions {
  frameCount?: number
  fps?: number
  /** Per-frame camera position; defaults to a slow dolly along +x. */
  positionAt?: (frame: number) => [number, number, number]
  /** Per-frame yaw in radians; defaults to a slow pan. */
  yawAt?: (frame: number) => number
  /** Per-frame aim point. `null` omits `target` entirely. */
  targetAt?: ((frame: number) => [number, number, number]) | null
  aspect?: number
}

export function makeCameraTrack(options: MakeCameraTrackOptions = {}): Scene3DCameraTrackV1 {
  const frameCount = options.frameCount ?? 48
  const fps = options.fps ?? 24
  const projectionMatrix = perspectiveMatrix(39.6, options.aspect ?? 1920 / 1080)
  const samples = Array.from({ length: frameCount }, (_, frame) => {
    const position = options.positionAt?.(frame) ?? [frame * 0.01, 1.6, 6]
    const yaw = options.yawAt?.(frame) ?? frame * 0.002
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, "XYZ"))
    const target =
      options.targetAt === null
        ? undefined
        : (options.targetAt?.(frame) ?? ([0, 1, 0] as [number, number, number]))
    return {
      position,
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] as [
        number,
        number,
        number,
        number,
      ],
      projectionMatrix,
      near: 0.1,
      far: 1000,
      ...(target ? { target } : {}),
      focalLengthMm: 50,
    }
  })
  return { format: "scene3d-camera-track", version: 1, frameStart: 0, frameCount, fps, samples }
}

/** The spec's own table example: 4 contiguous hard-cut shots over 720 frames. */
export const TABLE_SHOTS: Scene3DShot[] = [
  { id: "wide", startFrame: 0, endFrameExclusive: 360 },
  { id: "ots-a", startFrame: 360, endFrameExclusive: 432 },
  { id: "ots-b", startFrame: 432, endFrameExclusive: 492 },
  { id: "orbit", startFrame: 492, endFrameExclusive: 720 },
]

/**
 * Distributive omit — a plain `Omit<Union, …>` collapses the discriminated
 * union into its common keys, which would make every override in a test lose
 * its own fields.
 */
type OverrideInput = Scene3DOverride extends infer T
  ? T extends Scene3DOverride
    ? Omit<T, "id" | "sourceRevisionId" | "sourceContentHash" | "operationVersion"> & {
        id?: string
        operationVersion?: number
      }
    : never
  : never

/** Fills the provenance every override carries, so tests state only the edit. */
export function override(partial: OverrideInput): Scene3DOverride {
  const subject = partial as { entityId?: string; shotId?: string }
  return {
    id: partial.id ?? `ov-${partial.kind}-${subject.entityId ?? subject.shotId}`,
    sourceRevisionId: REVISION_ID,
    sourceContentHash: CONTENT_HASH,
    operationVersion: partial.operationVersion ?? 1,
    ...partial,
  } as Scene3DOverride
}

/** A primitive entity with the fields the contract requires. */
export function primitiveEntity(partial: Partial<Scene3DEntityV2> & { id: string }): Scene3DEntityV2 {
  return {
    name: partial.id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visual: { kind: "primitive", primitive: "box", dimensions: [1, 1, 1], color: "#e4a04c" },
    ...partial,
  } as Scene3DEntityV2
}

/** A group entity (organizational identity, no geometry). */
export function groupEntity(partial: Partial<Scene3DEntityV2> & { id: string }): Scene3DEntityV2 {
  return {
    name: partial.id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visual: { kind: "group" },
    ...partial,
  } as Scene3DEntityV2
}

export interface MakeV2PlanOptions {
  durationInFrames?: number
  fps?: number
  width?: number
  height?: number
  objects?: Scene3DEntityV2[]
  assets?: Scene3DAssetRef[]
  shots?: Scene3DShot[]
  overrides?: Scene3DOverride[]
  cameraTrackAssetId?: string
}

export function makeV2Plan(options: MakeV2PlanOptions = {}): Scene3DPlanV2 {
  const durationInFrames = options.durationInFrames ?? 48
  return {
    planType: "3d-scene",
    schemaVersion: 2,
    revisionId: REVISION_ID,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    fps: options.fps ?? 24,
    durationInFrames,
    units: "meters",
    upAxis: "Y",
    handedness: "right",
    backgroundColor: "#101014",
    objects: options.objects ?? [primitiveEntity({ id: "hero", position: [0, 0.5, 0] })],
    // A syntactically valid camera-track ref by default, so a shape-only test
    // does not have to build real bytes; `makeLoadableScene` replaces it with a
    // ref carrying the real length and digest.
    assets: options.assets ?? [
      {
        assetId: "cam",
        kind: "camera-track-json",
        role: "camera-track",
        byteLength: 2,
        sha256: "0".repeat(64),
      },
    ],
    cameraTrackAssetId: options.cameraTrackAssetId ?? "cam",
    shots: options.shots ?? [{ id: "only", startFrame: 0, endFrameExclusive: durationInFrames }],
    lighting: {
      preset: "clay-studio-v1",
      ambientIntensity: 0.55,
      keyIntensity: 1.6,
      keyPosition: [6, 8, 5],
    },
    ...(options.overrides ? { overrides: options.overrides } : {}),
    provenance: {
      engine: "blender-cloud",
      engineVersion: "4.2.0",
      recipeVersion: "1.0.0",
      compilerVersion: "1.0.0",
      exporterVersion: "1.0.0",
      rendererVersion: "1.0.0",
      contentHash: CONTENT_HASH,
    },
  }
}

/** A resolver over an in-memory `assetId → bytes` map. */
export function memoryResolver(
  bytesById: Record<string, ArrayBuffer>,
  onResolve?: (assetId: string) => void,
): Scene3DAssetResolver {
  return {
    async resolve(ref) {
      onResolve?.(ref.assetId)
      const bytes = bytesById[ref.assetId]
      if (!bytes) throw new Error(`no fixture bytes for ${ref.assetId}`)
      return bytes
    },
  }
}

/**
 * A complete, loadable scene: plan + asset refs (with real digests) + resolver.
 * `glb` is optional — a plan can be primitives-only and still needs its camera.
 */
export function makeLoadableScene(options: {
  glb?: ArrayBuffer
  glbAssetId?: string
  glbRole?: Scene3DAssetRole
  objects?: Scene3DEntityV2[]
  track?: Scene3DCameraTrackV1
  durationInFrames?: number
  fps?: number
  width?: number
  height?: number
  shots?: Scene3DShot[]
  overrides?: Scene3DOverride[]
}): { plan: Scene3DPlanV2; resolver: Scene3DAssetResolver; bytes: Record<string, ArrayBuffer> } {
  const durationInFrames = options.durationInFrames ?? 48
  const fps = options.fps ?? 24
  const width = options.width ?? 1920
  const height = options.height ?? 1080
  const track =
    options.track ??
    makeCameraTrack({ frameCount: durationInFrames, fps, aspect: width / height })
  const trackBytes = jsonAssetBytes(track)

  const assets: Scene3DAssetRef[] = [
    assetRefFor("cam", "camera-track-json", "camera-track", trackBytes),
  ]
  const bytes: Record<string, ArrayBuffer> = { cam: trackBytes }

  if (options.glb) {
    const id = options.glbAssetId ?? "glb"
    assets.push(assetRefFor(id, "glb", options.glbRole ?? "entity-geometry", options.glb))
    bytes[id] = options.glb
  }

  const plan = makeV2Plan({
    durationInFrames,
    fps,
    width,
    height,
    assets,
    objects: options.objects,
    shots: options.shots,
    overrides: options.overrides,
  })
  return { plan, resolver: memoryResolver(bytes), bytes }
}
