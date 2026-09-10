/**
 * Scene3D previsualization — the frozen wire contract (v1).
 *
 * ONE validated `Scene3DPlan` revision is shared by four consumers that must
 * never disagree about what a scene IS: the authoring LLM jobs
 * (`backend/src/routes/3d-scene.ts` + its worker), the browser preview and the
 * frame-deterministic Remotion export (`packages/remotion`), the canvas
 * (`frontend/`), and the SDK/MCP surface. Everything here is STRUCTURE —
 * geometry, timing, identity, validation. No creative prompts, no provider
 * names, no pricing: those live in the backend (see the IP-placement rule in
 * the repo CLAUDE.md — this package is published Apache-2.0 and every
 * published version is an irrevocable grant).
 *
 * ## World conventions (fixed for v1, relied on by the renderer)
 *
 * - Units are METERS, Y is up, right-handed (Three.js default).
 * - Rotations are Euler angles in RADIANS applied XYZ.
 * - Frames are ZERO-BASED; `fps` defaults to 24 at the authoring layer.
 * - Interpolation between keyframes is deterministic and closed-form:
 *   `linear` or `easeInOut` (smoothstep). There is no spring, no physics and
 *   no randomness — the browser preview and the export MUST agree frame for
 *   frame, so nothing here may depend on wall-clock time or a RNG.
 * - A channel's BASE value (the object's/camera's own `position`/`rotation`/
 *   `scale`/`target`/`focalLengthMm`) behaves as an implicit keyframe at frame
 *   0. So a track whose first key is at frame 30 INTERPOLATES from the base
 *   value at frame 0 to that key — it does not hold the base and then jump.
 *   Author a real key at frame 0 when you want a hold. Before frame 0 and
 *   after the last key the nearest key's value is held.
 * - `easing` belongs to the DESTINATION keyframe: the easing named on a key
 *   governs the segment ENDING at it. The easing on the first key therefore
 *   governs base → first key; a key's own easing never affects the segment
 *   leaving it.
 *   Sampling itself lives with the renderer (`packages/remotion`) — this file
 *   only guarantees the data it samples is well-formed.
 *
 * Camera and object RIGS are deliberately absent, and their absence is a
 * decision rather than an unfinished TODO: spline rails, follow-path and
 * track-to constraints, and procedural noise modifiers are authored UPSTREAM
 * (in Blender) and reach this contract already BAKED — v1 as keyframes on the
 * tracks above, v2 as one camera sample per frame. The format carries no
 * constraint or noise vocabulary ON PURPOSE, because evaluating a rig in two
 * different renderers cannot be guaranteed to agree frame for frame, and that
 * agreement is the promise everything else here rests on.
 *
 * ## Revisions
 *
 * A plan is IMMUTABLE. Every accepted edit produces a NEW `revisionId` and
 * records the one it came from in `parentRevisionId`; the input object is
 * never mutated (deep-copied before any write). That is what lets an
 * asynchronous job completion be REJECTED when the canvas has moved on — the
 * completion carries the parent it was computed from.
 */
import { z } from "zod"

/** Discriminates a Scene3D plan from every other composer plan on the wire. */
export const SCENE3D_PLAN_TYPE = "3d-scene"
/** Bumped only for a BREAKING change to the shape below. */
export const SCENE3D_SCHEMA_VERSION = 1
/** Frames per second an authoring request gets when it does not say. */
export const SCENE3D_DEFAULT_FPS = 24
/** Seconds a generate request gets when it does not say. */
export const SCENE3D_DEFAULT_DURATION_SECONDS = 4

/**
 * Every bound in one object so the route Zod, the canvas inputs, the LLM
 * draft schema and the docs quote the SAME numbers. Widening one of these is
 * a contract change, not a tweak.
 */
export const SCENE3D_LIMITS = {
  minDimensionPx: 100,
  /** Applies to BOTH axes, so the worst admissible frame is SQUARE, not merely
   *  wider — 2560x2560 is 3.2x the pixels of 1920x1080, and that is the frame
   *  this bound was measured at. Raised from 1920 once that cost was measured
   *  rather than assumed: on the software GL path a container actually uses,
   *  an animated 2560x2560 frame costs ~154 ms/frame against ~65 ms at
   *  1920x1080, so even `maxDurationInFrames` (3600) lands near 9 min against
   *  the render worker's 25-minute budget. Peak memory is the real price —
   *  ~3.1 GB across the browser process tree versus ~1.6 GB — and is the number
   *  to re-measure before widening this again. */
  maxDimensionPx: 2560,
  minFps: 15,
  maxFps: 60,
  minDurationInFrames: 1,
  maxDurationInFrames: 3600,
  /** Shortest scene an authoring request may ask for, in seconds. One second
   *  is the frozen v1 floor the SDK/MCP surface and the public docs state; the
   *  route Zod and the canvas path both quote it from here so they cannot
   *  drift below it. */
  minDurationSeconds: 1,
  /** Hard ceiling on wall-clock length, checked against fps × frames. */
  maxDurationSeconds: 60,
  minObjects: 1,
  maxObjects: 100,
  /** Per-object and per-camera track length. */
  maxKeyframes: 240,
  maxReferences: 8,
  maxOperations: 100,
  /** |x|, |y|, |z| ceiling for positions and camera/target coordinates. */
  maxCoordinate: 1000,
  minSize: 0.001,
  maxSize: 1000,
  minScale: 0.001,
  maxScale: 1000,
  minFocalLengthMm: 10,
  maxFocalLengthMm: 200,
  defaultSensorWidthMm: 36,
  minSensorWidthMm: 1,
  maxSensorWidthMm: 200,
  maxIntensity: 100,
  /** How deep a parent chain may nest. Bounds the renderer's transform walk. */
  maxHierarchyDepth: 8,
  maxIdLength: 64,
  maxNameLength: 120,
  maxUrlLength: 2048,
  maxChangeSummaryLength: 2000,
} as const

export type Vec3 = [number, number, number]

export type Scene3DPrimitive =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "plane"
  | "capsule"
  /** A transform-only node: no geometry of its own, children inherit it. */
  | "group"

export const SCENE3D_PRIMITIVES: readonly Scene3DPrimitive[] = [
  "box",
  "sphere",
  "cylinder",
  "cone",
  "plane",
  "capsule",
  "group",
]

export type Scene3DEasing = "linear" | "easeInOut"

export type Scene3DReferenceKind = "image" | "video"

/**
 * What the reference is FOR. The role is not decoration: it decides how the
 * authoring backend conditions on the asset (appearance → colour/material
 * cues, layout → placement, motion → timing), and it is stored with the job
 * so a re-run reproduces the same conditioning.
 */
export type Scene3DReferenceRole = "appearance" | "layout" | "motion"

export interface Scene3DObjectKeyframe {
  /** Zero-based, integral, inside the scene's duration. */
  frame: number
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  easing?: Scene3DEasing
}

export interface Scene3DCameraKeyframe {
  frame: number
  position?: Vec3
  target?: Vec3
  focalLengthMm?: number
  easing?: Scene3DEasing
}

export interface Scene3DObject {
  id: string
  name: string
  primitive: Scene3DPrimitive
  /** Transform parent. Absent = a root object. Cycles are rejected. */
  parentId?: string
  /** Intrinsic size in meters BEFORE `scale` (width/height/depth). */
  dimensions: Vec3
  position: Vec3
  /** Euler XYZ, radians. */
  rotation: Vec3
  scale: Vec3
  /** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
  color: string
  keyframes?: Scene3DObjectKeyframe[]
}

export interface Scene3DCamera {
  position: Vec3
  target: Vec3
  focalLengthMm: number
  /** Full-frame 36mm by default; together with focal length it fixes the FOV. */
  sensorWidthMm: number
  keyframes?: Scene3DCameraKeyframe[]
}

export interface Scene3DLighting {
  ambientIntensity: number
  keyIntensity: number
  keyPosition: Vec3
}

export interface Scene3DReference {
  id: string
  /** HTTP(S) only — the BACKEND additionally applies `safeUrlSchema` and the
   *  platform's per-model reference limits before anything is fetched. */
  url: string
  kind: Scene3DReferenceKind
  role: Scene3DReferenceRole
  /** Scopes the reference to one object instead of the whole scene. */
  objectId?: string
  /** Window inside a video reference, in seconds. */
  startSeconds?: number
  endSeconds?: number
}

/**
 * The v1 plan. `Scene3DPlan` is the DISCRIMINATED UNION of this and
 * `Scene3DPlanV2` (see `scene3d-v2.ts`) — a consumer holding one must narrow
 * with `isScene3DPlanV1` / `isScene3DPlanV2` before reading version-specific
 * fields. Nothing about v1's shape, bounds or messages changed when v2 landed.
 */
export interface Scene3DPlanV1 {
  planType: typeof SCENE3D_PLAN_TYPE
  schemaVersion: typeof SCENE3D_SCHEMA_VERSION
  /** UUID. Changes on EVERY accepted edit. */
  revisionId: string
  /** The revision this one was derived from; absent on a first generation. */
  parentRevisionId?: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  backgroundColor: string
  camera: Scene3DCamera
  objects: Scene3DObject[]
  lighting: Scene3DLighting
  references?: Scene3DReference[]
}

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

/** Tuple form, matching `backend/src/lib/plan-schemas.ts`'s `vec3Schema`.
 *  `z.number()` already rejects NaN and ±Infinity in zod 4, so "finite triple"
 *  needs no extra check — only the magnitude bound below. */
function boundedVec3(max: number, label: string) {
  return z.tuple([
    z.number().min(-max).max(max),
    z.number().min(-max).max(max),
    z.number().min(-max).max(max),
  ]).describe(label)
}

export const vec3Schema = boundedVec3(SCENE3D_LIMITS.maxCoordinate, "position triple (meters)")

export const sizeVec3Schema = z.tuple([
  z.number().min(SCENE3D_LIMITS.minSize).max(SCENE3D_LIMITS.maxSize),
  z.number().min(SCENE3D_LIMITS.minSize).max(SCENE3D_LIMITS.maxSize),
  z.number().min(SCENE3D_LIMITS.minSize).max(SCENE3D_LIMITS.maxSize),
])

export const scaleVec3Schema = z.tuple([
  z.number().min(SCENE3D_LIMITS.minScale).max(SCENE3D_LIMITS.maxScale),
  z.number().min(SCENE3D_LIMITS.minScale).max(SCENE3D_LIMITS.maxScale),
  z.number().min(SCENE3D_LIMITS.minScale).max(SCENE3D_LIMITS.maxScale),
])

/** Euler radians. Bounded well past ±2π so multi-turn spins stay expressible
 *  while a runaway value still cannot reach the renderer. */
export const rotationVec3Schema = boundedVec3(1000, "euler XYZ (radians)")

/**
 * OPAQUE hex only — 3 or 6 digits.
 *
 * Not a style preference: the renderer builds every colour with
 * `new THREE.Color(hex)`, which understands `#abc` and `#aabbcc` and nothing
 * else. A 4- or 8-digit value (the CSS `#rgba` / `#rrggbbaa` spelling) is not
 * refused there — it warns and falls back to WHITE, so an alpha the contract
 * accepted would silently repaint an object in the export. Transparency is not
 * part of the v1 material model; when it becomes one it will be its own field,
 * not a suffix on this string.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export const scene3DColorSchema = z
  .string()
  .regex(HEX_COLOR, "color must be an opaque hex string such as #4f8ef7 (3 or 6 digits; alpha is not supported)")

/** Renderer-safe identifier: it keys React elements and object maps. */
const SCENE3D_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

export const scene3DIdSchema = z
  .string()
  .min(1)
  .max(SCENE3D_LIMITS.maxIdLength)
  .regex(SCENE3D_ID, "id must start alphanumeric and contain only letters, digits, '_', '-' or '.'")

/** HTTP(S) only. This is the STRUCTURAL half of URL safety; the backend adds
 *  `safeUrlSchema` (SSRF host rules) on top before anything is fetched. */
export function isScene3DHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export const scene3DUrlSchema = z
  .string()
  .min(1)
  .max(SCENE3D_LIMITS.maxUrlLength)
  .refine(isScene3DHttpUrl, "url must be an http(s) URL")

export const scene3DEasingSchema = z.enum(["linear", "easeInOut"])

export const scene3DPrimitiveSchema = z.enum([
  "box",
  "sphere",
  "cylinder",
  "cone",
  "plane",
  "capsule",
  "group",
])

const frameSchema = z.number().int().min(0).max(SCENE3D_LIMITS.maxDurationInFrames)

export const scene3DObjectKeyframeSchema = z
  .object({
    frame: frameSchema,
    position: vec3Schema.optional(),
    rotation: rotationVec3Schema.optional(),
    scale: scaleVec3Schema.optional(),
    easing: scene3DEasingSchema.optional(),
  })
  .strict()

export const scene3DCameraKeyframeSchema = z
  .object({
    frame: frameSchema,
    position: vec3Schema.optional(),
    target: vec3Schema.optional(),
    focalLengthMm: z
      .number()
      .min(SCENE3D_LIMITS.minFocalLengthMm)
      .max(SCENE3D_LIMITS.maxFocalLengthMm)
      .optional(),
    easing: scene3DEasingSchema.optional(),
  })
  .strict()

export const scene3DObjectSchema = z
  .object({
    id: scene3DIdSchema,
    name: z.string().min(1).max(SCENE3D_LIMITS.maxNameLength),
    primitive: scene3DPrimitiveSchema,
    parentId: scene3DIdSchema.optional(),
    dimensions: sizeVec3Schema,
    position: vec3Schema,
    rotation: rotationVec3Schema,
    scale: scaleVec3Schema,
    color: scene3DColorSchema,
    keyframes: z.array(scene3DObjectKeyframeSchema).max(SCENE3D_LIMITS.maxKeyframes).optional(),
  })
  .strict()

export const scene3DCameraSchema = z
  .object({
    position: vec3Schema,
    target: vec3Schema,
    focalLengthMm: z
      .number()
      .min(SCENE3D_LIMITS.minFocalLengthMm)
      .max(SCENE3D_LIMITS.maxFocalLengthMm),
    sensorWidthMm: z
      .number()
      .min(SCENE3D_LIMITS.minSensorWidthMm)
      .max(SCENE3D_LIMITS.maxSensorWidthMm)
      .default(SCENE3D_LIMITS.defaultSensorWidthMm),
    keyframes: z.array(scene3DCameraKeyframeSchema).max(SCENE3D_LIMITS.maxKeyframes).optional(),
  })
  .strict()

export const scene3DLightingSchema = z
  .object({
    ambientIntensity: z.number().min(0).max(SCENE3D_LIMITS.maxIntensity),
    keyIntensity: z.number().min(0).max(SCENE3D_LIMITS.maxIntensity),
    keyPosition: vec3Schema,
  })
  .strict()

export const scene3DReferenceSchema = z
  .object({
    id: scene3DIdSchema,
    url: scene3DUrlSchema,
    kind: z.enum(["image", "video"]),
    role: z.enum(["appearance", "layout", "motion"]),
    objectId: scene3DIdSchema.optional(),
    startSeconds: z.number().min(0).max(86_400).optional(),
    endSeconds: z.number().min(0).max(86_400).optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Semantic (cross-field) validation
// ---------------------------------------------------------------------------

/** One cross-field failure, in the shape `ctx.addIssue` wants. Shared by the
 *  v1 and v2 validators so both report the same way. */
export interface Scene3DSemanticIssue {
  path: (string | number)[]
  message: string
}

/** @internal Historic in-file name. */
type SemanticIssue = Scene3DSemanticIssue

function checkKeyframeTrack(
  frames: readonly { frame: number }[],
  durationInFrames: number,
  path: (string | number)[],
  issues: SemanticIssue[],
): void {
  let previous = -1
  frames.forEach((kf, index) => {
    if (kf.frame > durationInFrames - 1) {
      issues.push({
        path: [...path, index, "frame"],
        message: `frame ${kf.frame} is past the scene's last frame (${durationInFrames - 1})`,
      })
    }
    if (kf.frame === previous) {
      issues.push({ path: [...path, index, "frame"], message: `duplicate keyframe at frame ${kf.frame}` })
    } else if (kf.frame < previous) {
      issues.push({
        path: [...path, index, "frame"],
        message: `keyframes must be sorted by frame (${kf.frame} follows ${previous})`,
      })
    }
    previous = kf.frame
  })
}

/**
 * Every rule that needs more than one field: duration, identity, hierarchy,
 * reference resolution and keyframe tracks.
 *
 * Split out of the schema's `superRefine` so `applyScene3DEditOperations` can
 * report the SAME sentences without re-parsing, and so a caller holding an
 * already-parsed plan can re-check it cheaply.
 */
export function scene3DPlanV1Issues(plan: Scene3DPlanV1): SemanticIssue[] {
  const issues: SemanticIssue[] = []

  const seconds = plan.durationInFrames / plan.fps
  if (seconds > SCENE3D_LIMITS.maxDurationSeconds) {
    issues.push({
      path: ["durationInFrames"],
      message: `scene is ${seconds.toFixed(2)}s; the limit is ${SCENE3D_LIMITS.maxDurationSeconds}s`,
    })
  }

  const byId = new Map<string, Scene3DObject>()
  plan.objects.forEach((object, index) => {
    if (byId.has(object.id)) {
      issues.push({ path: ["objects", index, "id"], message: `duplicate object id "${object.id}"` })
      return
    }
    byId.set(object.id, object)
  })

  plan.objects.forEach((object, index) => {
    if (object.parentId === undefined) return
    if (object.parentId === object.id) {
      issues.push({ path: ["objects", index, "parentId"], message: `object "${object.id}" cannot parent itself` })
      return
    }
    if (!byId.has(object.parentId)) {
      issues.push({
        path: ["objects", index, "parentId"],
        message: `object "${object.id}" references unknown parent "${object.parentId}"`,
      })
      return
    }
    // Walk to the root: a cycle repeats an id, and a legal chain is bounded.
    const seen = new Set<string>([object.id])
    let cursor: Scene3DObject | undefined = byId.get(object.parentId)
    let depth = 1
    while (cursor) {
      if (seen.has(cursor.id)) {
        issues.push({
          path: ["objects", index, "parentId"],
          message: `parent cycle through object "${cursor.id}"`,
        })
        break
      }
      seen.add(cursor.id)
      depth += 1
      if (depth > SCENE3D_LIMITS.maxHierarchyDepth) {
        issues.push({
          path: ["objects", index, "parentId"],
          message: `hierarchy deeper than ${SCENE3D_LIMITS.maxHierarchyDepth} levels`,
        })
        break
      }
      cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId)
    }
  })

  plan.objects.forEach((object, index) => {
    if (object.keyframes && object.keyframes.length > 0) {
      checkKeyframeTrack(object.keyframes, plan.durationInFrames, ["objects", index, "keyframes"], issues)
    }
  })
  if (plan.camera.keyframes && plan.camera.keyframes.length > 0) {
    checkKeyframeTrack(plan.camera.keyframes, plan.durationInFrames, ["camera", "keyframes"], issues)
  }

  const referenceIds = new Set<string>()
  ;(plan.references ?? []).forEach((reference, index) => {
    if (referenceIds.has(reference.id)) {
      issues.push({ path: ["references", index, "id"], message: `duplicate reference id "${reference.id}"` })
    }
    referenceIds.add(reference.id)
    if (reference.objectId !== undefined && !byId.has(reference.objectId)) {
      issues.push({
        path: ["references", index, "objectId"],
        message: `reference "${reference.id}" points at unknown object "${reference.objectId}"`,
      })
    }
    if (
      reference.startSeconds !== undefined &&
      reference.endSeconds !== undefined &&
      reference.endSeconds <= reference.startSeconds
    ) {
      issues.push({
        path: ["references", index, "endSeconds"],
        message: `reference "${reference.id}" ends at or before it starts`,
      })
    }
    if (reference.kind === "image" && (reference.startSeconds !== undefined || reference.endSeconds !== undefined)) {
      issues.push({
        path: ["references", index, "startSeconds"],
        message: `reference "${reference.id}" is an image; a time window applies to video only`,
      })
    }
  })

  return issues
}

/**
 * THE plan validator. Structure first (zod), then the cross-field rules — a
 * consumer that parses with this cannot be handed a cycle, a dangling parent,
 * an out-of-range keyframe or a 90-second "one-minute-max" scene.
 */
/**
 * The v1 object shape WITHOUT the cross-field pass. Exported only so
 * `scene3DAnyPlanSchema` can discriminate on `schemaVersion` (zod cannot
 * discriminate through a `superRefine`); parse with `scene3DPlanV1Schema`.
 */
export const scene3DPlanV1ObjectSchema = z
  .object({
    planType: z.literal(SCENE3D_PLAN_TYPE),
    schemaVersion: z.literal(SCENE3D_SCHEMA_VERSION),
    revisionId: z.uuid(),
    parentRevisionId: z.uuid().optional(),
    width: z.number().int().min(SCENE3D_LIMITS.minDimensionPx).max(SCENE3D_LIMITS.maxDimensionPx),
    height: z.number().int().min(SCENE3D_LIMITS.minDimensionPx).max(SCENE3D_LIMITS.maxDimensionPx),
    fps: z.number().int().min(SCENE3D_LIMITS.minFps).max(SCENE3D_LIMITS.maxFps),
    durationInFrames: z
      .number()
      .int()
      .min(SCENE3D_LIMITS.minDurationInFrames)
      .max(SCENE3D_LIMITS.maxDurationInFrames),
    backgroundColor: scene3DColorSchema,
    camera: scene3DCameraSchema,
    objects: z.array(scene3DObjectSchema).min(SCENE3D_LIMITS.minObjects).max(SCENE3D_LIMITS.maxObjects),
    lighting: scene3DLightingSchema,
    references: z.array(scene3DReferenceSchema).max(SCENE3D_LIMITS.maxReferences).optional(),
  })
  .strict()

export const scene3DPlanV1Schema = scene3DPlanV1ObjectSchema.superRefine((plan, ctx) => {
  for (const issue of scene3DPlanV1Issues(plan as Scene3DPlanV1)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
  }
})

/** @deprecated v1-only, and it always was. Kept so every existing v1 call site
 *  keeps EXACTLY its current accept/reject set. Use `scene3DPlanV1Schema` for
 *  v1, or `scene3DAnyPlanSchema` when either version is acceptable. */
export const scene3DPlanSchema = scene3DPlanV1Schema

/** @deprecated Renamed to `scene3DPlanV1Issues`. */
export const scene3DPlanIssues = scene3DPlanV1Issues

/** Order-insensitive deep equality over the JSON subset a plan is made of. */
export function scene3DDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => scene3DDeepEqual(item, b[i]))
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => key in bObj && scene3DDeepEqual(aObj[key], bObj[key]))
}

/** RFC-4122 v4 id, from the platform CSPRNG where there is one. Browser,
 *  Node 18+ and the Remotion renderer all expose `globalThis.crypto`. */
export function newScene3DRevisionId(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Narrowing helper for callers holding `unknown` (job output, workflow JSON).
 *  V1 ONLY — `isScene3DPlan` (in `scene3d-v2.ts`) accepts either version. */
export function isScene3DPlanV1(value: unknown): value is Scene3DPlanV1 {
  return scene3DPlanV1Schema.safeParse(value).success
}

// ---------------------------------------------------------------------------
// Job / route wire shapes
// ---------------------------------------------------------------------------

/** What a finished `generate-3d-scene` / `edit-3d-scene` job carries in
 *  `output_data`. The canvas, the SDK and the DAG output extractor all read
 *  THIS shape — `scenePlan` is also the node's stored plan field. */
export interface Scene3DJobOutput {
  scenePlan: Scene3DPlanV1
  /** One paragraph naming what changed. Absent on a first generation. */
  changeSummary?: string
}

/** The node data field a Scene3D plan is stored under, on both nodes.
 *  `COMPOSER_PLAN_MAP` (model-constants.ts) must agree with this. */
export const SCENE3D_PLAN_FIELD = "scenePlan"

/** The two canvas node types that produce a Scene3D plan. */
export const SCENE3D_GENERATE_NODE_TYPE = "generate-3d-scene"
export const SCENE3D_EDIT_NODE_TYPE = "edit-3d-scene"
