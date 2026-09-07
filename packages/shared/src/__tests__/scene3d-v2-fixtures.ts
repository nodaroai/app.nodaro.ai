/**
 * Shared v2 fixtures. Deliberately generic (`e1`, `shot-1`, one car-ish
 * assembly) — the contract has no opinion about what a scene contains, and a
 * fixture that encodes one would quietly become a spec.
 *
 * The one non-arbitrary thing here is the SHAPE of the timeline: 720 frames at
 * 24 fps cut into `[0,360) [360,432) [432,492) [492,720)`. That is the exact
 * multi-shot arrangement the format has to carry, so every coverage test uses
 * it rather than a two-shot toy.
 */
import {
  SCENE3D_CAMERA_TRACK_FORMAT,
  SCENE3D_CAMERA_TRACK_VERSION,
  type Scene3DCameraSample,
  type Scene3DCameraTrackV1,
} from "../scene3d-camera-track.js"
import { SCENE3D_SCHEMA_VERSION_V2, type Scene3DPlanV2, type Scene3DShot } from "../scene3d-v2.js"
import { SCENE3D_PLAN_TYPE } from "../scene3d.js"

export const FIXTURE_WIDTH = 1680
export const FIXTURE_HEIGHT = 720
export const FIXTURE_FPS = 24
export const FIXTURE_FRAMES = 720

/** The cut plan the format must be able to express exactly. */
export const FIXTURE_CUTS: ReadonlyArray<readonly [number, number]> = [
  [0, 360],
  [360, 432],
  [432, 492],
  [492, 720],
]

const REVISION_ID = "6d5b0b64-2b6c-4d4a-9e4f-2f4b7f6a1c01"
const PARENT_REVISION_ID = "6d5b0b64-2b6c-4d4a-9e4f-2f4b7f6a1c00"
const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const HASH_C = "c".repeat(64)
const HASH_D = "d".repeat(64)

/**
 * A symmetric column-major perspective matrix, exactly as Three.js and every
 * glTF camera build one. `m[0]/m[5]` is `height/width`, which is what the
 * manifest cross-check reads.
 */
export function perspectiveMatrix(
  fovYDegrees: number,
  aspect: number,
  near: number,
  far: number,
): number[] {
  const top = near * Math.tan((fovYDegrees * Math.PI) / 360)
  const height = 2 * top
  const width = height * aspect
  const matrix = new Array<number>(16).fill(0)
  matrix[0] = (2 * near) / width
  matrix[5] = (2 * near) / height
  matrix[10] = -(far + near) / (far - near)
  matrix[11] = -1
  matrix[14] = (-2 * far * near) / (far - near)
  return matrix
}

/** An orthographic matrix — the thing the projection validator must NAME rather
 *  than mis-read as a broken perspective. */
export function orthographicMatrix(near: number, far: number): number[] {
  const matrix = new Array<number>(16).fill(0)
  matrix[0] = 1
  matrix[5] = 1
  matrix[10] = -2 / (far - near)
  matrix[14] = -(far + near) / (far - near)
  matrix[15] = 1
  return matrix
}

export function cameraSample(overrides: Partial<Scene3DCameraSample> = {}): Scene3DCameraSample {
  return {
    position: [0, 1.5, 4],
    quaternion: [0, 0, 0, 1],
    projectionMatrix: perspectiveMatrix(35, FIXTURE_WIDTH / FIXTURE_HEIGHT, 0.1, 200),
    near: 0.1,
    far: 200,
    ...overrides,
  }
}

export function cameraTrack(
  frameCount = FIXTURE_FRAMES,
  overrides: Partial<Scene3DCameraTrackV1> = {},
): Scene3DCameraTrackV1 {
  return {
    format: SCENE3D_CAMERA_TRACK_FORMAT,
    version: SCENE3D_CAMERA_TRACK_VERSION,
    frameStart: 0,
    frameCount,
    fps: FIXTURE_FPS,
    samples: Array.from({ length: frameCount }, (_unused, frame) =>
      cameraSample({ position: [frame / 100, 1.5, 4] }),
    ),
    ...overrides,
  }
}

export function fixtureShots(): Scene3DShot[] {
  return FIXTURE_CUTS.map(([startFrame, endFrameExclusive], index) => ({
    id: `shot-${index + 1}`,
    startFrame,
    endFrameExclusive,
    subjectEntityIds: ["e2"],
    foregroundEntityIds: ["e3"],
  }))
}

/**
 * A complete, valid v2 manifest: one group assembly with an asset child and a
 * primitive sibling, three renderer-visible assets plus a retained source, four
 * contiguous shots, one of each override kind.
 */
export function planV2(overrides: Partial<Scene3DPlanV2> = {}): Scene3DPlanV2 {
  return {
    planType: SCENE3D_PLAN_TYPE,
    schemaVersion: SCENE3D_SCHEMA_VERSION_V2,
    revisionId: REVISION_ID,
    parentRevisionId: PARENT_REVISION_ID,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    fps: FIXTURE_FPS,
    durationInFrames: FIXTURE_FRAMES,
    units: "meters",
    upAxis: "Y",
    handedness: "right",
    objects: [
      {
        id: "e1",
        name: "Assembly",
        role: "other",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        visual: { kind: "group" },
      },
      {
        id: "e2",
        name: "Vehicle",
        parentId: "e1",
        role: "vehicle",
        identityColor: "#3355ff",
        anchors: [
          { name: "roof", position: [0, 1.4, 0] },
          { name: "wheel.frontLeft", position: [0.8, 0.3, 1.2] },
        ],
        capabilities: ["transform", "color", "visibility"],
        materialBindings: [
          { role: "bodyPaint", materialName: "Body Paint", color: "#3355ff" },
          { role: "tires", materialName: "Rubber", roughness: 0.9 },
        ],
        visual: {
          kind: "asset",
          assetId: "asset-vehicle",
          rootNodeId: "vehicle_root",
          animation: { clipName: "drive", startFrame: 0, endFrameExclusive: 720 },
        },
      },
      {
        id: "e3",
        name: "Marker",
        role: "prop",
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        visual: { kind: "primitive", primitive: "box", dimensions: [1, 1, 1], color: "#22cc88" },
      },
    ],
    assets: [
      { assetId: "asset-vehicle", kind: "glb", role: "entity-geometry", byteLength: 1_200_000, sha256: HASH_A },
      { assetId: "asset-track", kind: "camera-track-json", role: "camera-track", byteLength: 640_000, sha256: HASH_B },
      { assetId: "asset-poster", kind: "poster", role: "poster", byteLength: 90_000, sha256: HASH_C },
      { assetId: "asset-source", kind: "blend-source", role: "source", byteLength: 40_000_000, sha256: HASH_D },
    ],
    cameraTrackAssetId: "asset-track",
    shots: fixtureShots(),
    lighting: {
      preset: "clay-studio-v1",
      ambientIntensity: 0.6,
      keyIntensity: 2.4,
      keyPosition: [4, 6, 3],
    },
    backgroundColor: "#101014",
    overrides: [
      {
        id: "ov-1",
        sourceRevisionId: PARENT_REVISION_ID,
        sourceContentHash: HASH_A,
        operationVersion: 1,
        kind: "entity-transform",
        entityId: "e2",
        space: "world",
        position: [1, 0, 0],
      },
      {
        id: "ov-2",
        sourceRevisionId: PARENT_REVISION_ID,
        sourceContentHash: HASH_A,
        operationVersion: 1,
        kind: "entity-color",
        entityId: "e2",
        materialRole: "bodyPaint",
        color: "#ff2200",
      },
      {
        id: "ov-3",
        sourceRevisionId: PARENT_REVISION_ID,
        sourceContentHash: HASH_A,
        operationVersion: 1,
        kind: "camera-shot-offset",
        shotId: "shot-2",
        positionOffset: [0, 0.1, 0],
      },
    ],
    provenance: {
      engine: "blender-cloud",
      engineVersion: "1.4.0",
      recipeVersion: "1.0.0",
      compilerVersion: "0.9.2",
      exporterVersion: "0.9.2",
      rendererVersion: "3.1.0",
      sourceRevisionId: PARENT_REVISION_ID,
      sourceArtifactId: "asset-source",
      contentHash: "0".repeat(64),
    },
    ...overrides,
  }
}
