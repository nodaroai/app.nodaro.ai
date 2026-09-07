/**
 * Scene3D v2 — the PUBLIC wire contract for exported (GLB-backed) scenes.
 *
 * One Scene3D family, two schema versions. `Scene3DPlan` is the discriminated
 * union `Scene3DPlanV1 | Scene3DPlanV2`, keyed on `schemaVersion`; v1 (see
 * `scene3d.ts`) is untouched — same fields, same bounds, same messages — and a
 * default v1 authoring request must never come back as v2.
 *
 * What v2 adds over v1's inline primitives:
 *
 * - **Assets.** Geometry lives in GLB files referenced by opaque id + SHA-256
 *   digest, never by an expiring URL. The camera lives in a sidecar
 *   (`scene3d-camera-track.ts`), one sample per frame, so a 720-frame baked
 *   move is not squeezed through v1's 240-keyframe budget.
 * - **Semantic entities.** A user-selectable object or assembly — a person, a
 *   car, a prop, an environment — not every mesh in the export. Entities carry
 *   stable ids, anchors, identity colour and material-role bindings, so
 *   recolouring a person cannot recolour its chair.
 * - **Shots.** Explicit contiguous integer ranges covering the whole timeline,
 *   with hard cuts. Interpolation never spans a cut.
 * - **Overlays.** Deterministic entity/camera overrides applied over immutable
 *   baked bytes, in a fixed order, so a rebuild cannot silently drop a manual
 *   edit.
 * - **Provenance.** Which engine/compiler/exporter/renderer produced this, and
 *   the canonical content hash of the revision.
 *
 * This file is STRUCTURE ONLY: shapes, bounds, cross-references. How a scene is
 * authored, how a camera move is solved and what any of it costs are not part
 * of the published contract and are not here.
 *
 * It owns the VOCABULARY — constants, types and per-component schemas. The
 * whole-plan schema and every cross-field rule live in `scene3d-v2-plan.ts`,
 * which builds on this; the dense camera sidecar lives in
 * `scene3d-camera-track.ts`. Consumers import all three from the package root.
 *
 * ## World conventions (identical to v1, and now stated on the wire)
 *
 * Meters, Y up, right-handed, zero-based frames. `units`/`upAxis`/`handedness`
 * are required literals so a reader can refuse a manifest that assumes anything
 * else instead of quietly rendering a Z-up scene on its side. Conversion from
 * the authoring package's basis happens exactly once, at export: a GLB that is
 * already Y-up must not be rotated again, and the renderer must not replace an
 * exported camera quaternion with a `lookAt()`.
 */
import {
  SCENE3D_LIMITS,
  SCENE3D_PLAN_TYPE,
  rotationVec3Schema,
  scaleVec3Schema,
  scene3DColorSchema,
  scene3DIdSchema,
  scene3DReferenceSchema,
  sizeVec3Schema,
  vec3Schema,
  type Scene3DPrimitive,
  type Scene3DReference,
  type Scene3DSemanticIssue,
  type Vec3,
} from "./scene3d.js"
import { z } from "zod"

/** The v2 discriminator value. v1's `SCENE3D_SCHEMA_VERSION` is unchanged. */
export const SCENE3D_SCHEMA_VERSION_V2 = 2

/** Every version this package can parse AND validate. An SDK consumer checks a
 *  plan against this BEFORE trying to render one it cannot understand. */
export const SCENE3D_SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const
export type Scene3DSupportedSchemaVersion = (typeof SCENE3D_SUPPORTED_SCHEMA_VERSIONS)[number]

/** Authoring engines a v2 manifest may name. Open-ended on the wire (the field
 *  is a bounded slug) so a new engine does not need a package release; this
 *  list is what the current platform ships. */
export const SCENE3D_V2_ENGINES = ["blender-cloud", "blender-local"] as const
export type Scene3DKnownEngine = (typeof SCENE3D_V2_ENGINES)[number]

/**
 * Admission bounds for v2. Server-configured ceilings are returned in
 * capabilities; these are the contract's hard maxima, quoted by the route Zod,
 * the builder, the renderer and the docs so they cannot drift apart.
 *
 * v1's `SCENE3D_LIMITS` is NOT changed by any of this — "raise maxObjects" was
 * never the v2 design.
 */
export const SCENE3D_V2_LIMITS = {
  /** Both the seconds and the frame ceiling apply; neither waives the other. */
  maxDurationSeconds: 60,
  minDurationInFrames: 1,
  maxDurationInFrames: 3600,
  minFps: 15,
  maxFps: 60,
  defaultFps: 24,
  /** Even integers only — an odd axis breaks H.264 chroma subsampling. */
  minDimensionPx: 100,
  maxDimensionPx: 1920,
  minEntities: 1,
  /** SEMANTIC entities, not exported mesh nodes. */
  maxEntities: 100,
  /** Enforced during asset normalization, after decode — see
   *  `scene3DV2NormalizationIssues` in `scene3d-v2-resources.ts`. */
  maxMeshNodes: 2000,
  maxTriangles: 200_000,
  maxHierarchyDepth: 16,
  /** Decoded manifest JSON. Measured on the bytes, before `JSON.parse`. */
  maxManifestBytes: 512 * 1024,
  /** Decoded camera-track JSON. */
  maxCameraTrackBytes: 8 * 1024 * 1024,
  /** Total DECLARED bytes of the assets the renderer downloads. Compression
   *  does not waive the decoded geometry limits above. */
  maxRendererAssetBytes: 64 * 1024 * 1024,
  /** A `blend-source` is a separately authorized download, never handed to the
   *  browser renderer, and therefore not part of the renderer budget. */
  maxBlendSourceBytes: 512 * 1024 * 1024,
  maxAssets: 64,
  maxShots: 32,
  maxShotEntityIds: 16,
  /** v1's reference limit, unchanged until deliberately expanded. */
  maxReferences: SCENE3D_LIMITS.maxReferences,
  maxAnchorsPerEntity: 32,
  maxMaterialBindingsPerEntity: 16,
  maxOverrides: 200,
  minPosterDimensionPx: 16,
  maxPosterDimensionPx: 4096,
  maxIdLength: SCENE3D_LIMITS.maxIdLength,
  maxAssetIdLength: 128,
  maxNodeIdLength: 128,
  maxNameLength: SCENE3D_LIMITS.maxNameLength,
  maxLabelLength: SCENE3D_LIMITS.maxNameLength,
  maxMaterialNameLength: 120,
  maxVersionLength: 64,
  maxCoordinate: SCENE3D_LIMITS.maxCoordinate,
  minSize: SCENE3D_LIMITS.minSize,
  maxSize: SCENE3D_LIMITS.maxSize,
  maxIntensity: SCENE3D_LIMITS.maxIntensity,
} as const

/** The overlay operation vocabulary this package understands. An override
 *  written by a NEWER writer is rejected with an explicit message rather than
 *  silently skipped — a dropped edit is worse than a refused manifest. */
export const SCENE3D_V2_OVERRIDE_OPERATION_VERSION = 1

// ---------------------------------------------------------------------------
// GLB metadata allowlist
// ---------------------------------------------------------------------------

/**
 * The GLB `extras` keys the exporter writes and the importer reads. Blender
 * display names and array indices are NOT durable identifiers: a re-export
 * renames `Cube.003` and reorders children, and a hit-test would then select a
 * different entity. Both ends import these constants — never the literals.
 */
export const SCENE3D_GLB_EXTRAS_ENTITY_ID = "nodaroEntityId"
export const SCENE3D_GLB_EXTRAS_SUBPART_ID = "nodaroSubpartId"
export const SCENE3D_GLB_EXTRAS_MATERIAL_ROLE = "nodaroMaterialRole"

/** Nothing outside this set is read from `extras`; an importer ignores the rest
 *  rather than trusting arbitrary exporter metadata. */
export const SCENE3D_GLB_EXTRAS_ALLOWLIST = [
  SCENE3D_GLB_EXTRAS_ENTITY_ID,
  SCENE3D_GLB_EXTRAS_SUBPART_ID,
  SCENE3D_GLB_EXTRAS_MATERIAL_ROLE,
] as const

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** What an entity IS, for selection, grouping and validation reporting. It is
 *  advisory: no rule anywhere requires a head on a car or a wheel on a person. */
export type Scene3DEntityRole = "person" | "vehicle" | "prop" | "environment" | "other"
export const SCENE3D_ENTITY_ROLES: readonly Scene3DEntityRole[] = [
  "person",
  "vehicle",
  "prop",
  "environment",
  "other",
]

/** The v1 primitive vocabulary MINUS `group` — grouping is `visual.kind:"group"`
 *  in v2, so there is exactly one way to say "no geometry". */
export type Scene3DV2Primitive = Exclude<Scene3DPrimitive, "group">
export const SCENE3D_V2_PRIMITIVES: readonly Scene3DV2Primitive[] = [
  "box",
  "sphere",
  "cylinder",
  "cone",
  "plane",
  "capsule",
]

/** Deterministic overlays an entity accepts. Geometry and pose are deliberately
 *  absent: those rebuild through the authoring engine, they are not overlays. */
export type Scene3DEntityCapability = "transform" | "color" | "visibility"
export const SCENE3D_ENTITY_CAPABILITIES: readonly Scene3DEntityCapability[] = [
  "transform",
  "color",
  "visibility",
]

/** What an entity accepts when it does not say. */
export const SCENE3D_DEFAULT_ENTITY_CAPABILITIES: readonly Scene3DEntityCapability[] =
  SCENE3D_ENTITY_CAPABILITIES

export type Scene3DAssetKind = "glb" | "camera-track-json" | "poster" | "validation-report" | "blend-source"
export const SCENE3D_ASSET_KINDS: readonly Scene3DAssetKind[] = [
  "glb",
  "camera-track-json",
  "poster",
  "validation-report",
  "blend-source",
]

export type Scene3DAssetRole =
  | "scene-geometry"
  | "entity-geometry"
  | "camera-track"
  | "poster"
  | "validation-report"
  | "source"
export const SCENE3D_ASSET_ROLES: readonly Scene3DAssetRole[] = [
  "scene-geometry",
  "entity-geometry",
  "camera-track",
  "poster",
  "validation-report",
  "source",
]

/** Which kinds may carry which role. A role is not decoration — it is what lets
 *  a resolver decide whether bytes go to the renderer, the UI or an authorized
 *  download, without sniffing the file. */
export const SCENE3D_ASSET_ROLE_KINDS: Readonly<Record<Scene3DAssetRole, Scene3DAssetKind>> = {
  "scene-geometry": "glb",
  "entity-geometry": "glb",
  "camera-track": "camera-track-json",
  poster: "poster",
  "validation-report": "validation-report",
  source: "blend-source",
}

/** The kinds the BROWSER downloads. `blend-source` is never in this set: it is
 *  a separately authorized download and it does not spend the renderer budget. */
export const SCENE3D_RENDERER_ASSET_KINDS: readonly Scene3DAssetKind[] = [
  "glb",
  "camera-track-json",
  "poster",
]

/** The one material role a `primitive` entity has: its own `color`. */
export const SCENE3D_PRIMITIVE_MATERIAL_ROLE = "identity"

/** The standardized clay look, pinned by id. Browser preview, critic stills and
 *  the final export must implement a given preset identically. */
export const SCENE3D_CLAY_LIGHTING_PRESETS = ["clay-studio-v1"] as const
export type Scene3DClayLightingPreset = (typeof SCENE3D_CLAY_LIGHTING_PRESETS)[number]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A stable contact/selection location in entity-local space. Names are free
 *  structural labels (`face`, `seat`, `wheel.frontLeft`, `roof`, `lookAt`) —
 *  human anatomy is never required. */
export interface Scene3DAnchor {
  name: string
  position: Vec3
  /** Euler XYZ radians. Absent = identity orientation. */
  rotation?: Vec3
}

/** Binds an editable colour ROLE to a real material inside the entity's own
 *  asset root. Recolouring `bodyPaint` on a car must not touch its tires, and
 *  cannot reach a material that belongs to a different entity. */
export interface Scene3DMaterialBinding {
  role: string
  materialName: string
  /** Baked colour for the role, sRGB opaque hex. */
  color?: string
  roughness?: number
}

/** Maps a clip inside the referenced GLB onto public frames. Sampling is
 *  `time = (frame - startFrame) / fps` — never a wall-clock mixer delta, or
 *  scrubbing backwards would not reproduce the rendered frame. */
export interface Scene3DAssetAnimation {
  clipName: string
  startFrame: number
  endFrameExclusive: number
  /** Absent/false = hold the last sample after the window. */
  loop?: boolean
}

export type Scene3DEntityVisual =
  /** Organizational identity: a transform and a name, no geometry of its own. */
  | { kind: "group" }
  /** The v1 primitive vocabulary and validated dimensions. */
  | { kind: "primitive"; primitive: Scene3DV2Primitive; dimensions: Vec3; color: string }
  /** An authorized GLB plus the exported node that roots this entity. */
  | { kind: "asset"; assetId: string; rootNodeId: string; animation?: Scene3DAssetAnimation }

export interface Scene3DEntityV2 {
  id: string
  name: string
  /** Transform parent, another entity. Cycles are rejected. */
  parentId?: string
  role?: Scene3DEntityRole
  /**
   * Local base transform. REQUIRED for `group` and `primitive`.
   *
   * OPTIONAL for `asset`, where the GLB node's own transform is authoritative:
   * a value here is an informational frame-0 snapshot and the renderer must NOT
   * apply it on top of the node transform. Applying both is the
   * double-transform bug that puts a car at twice its offset.
   */
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  /** The selection/identity chip colour. Opaque hex, sRGB. */
  identityColor?: string
  anchors?: Scene3DAnchor[]
  /** Deterministic overlays this entity accepts. Absent = all of them. */
  capabilities?: Scene3DEntityCapability[]
  /** Currently frozen subset. An overlay is accepted iff its capability is
   *  advertised AND not locked. */
  locks?: Scene3DEntityCapability[]
  /** `asset` entities only. */
  materialBindings?: Scene3DMaterialBinding[]
  visual: Scene3DEntityVisual
}

/** A reference to immutable bytes. IDs and digests are persisted; short-lived
 *  transport URLs are issued by the authenticated resolver and never stored. */
export interface Scene3DAssetRef {
  assetId: string
  kind: Scene3DAssetKind
  role: Scene3DAssetRole
  byteLength: number
  /** Lowercase hex SHA-256 of the bytes. */
  sha256: string
  /** Set when this revision reuses an earlier revision's immutable bytes. */
  originRevisionId?: string
}

/** A contiguous half-open frame range `[startFrame, endFrameExclusive)`. */
export interface Scene3DShot {
  id: string
  startFrame: number
  endFrameExclusive: number
  label?: string
  /** Who the shot is ABOUT — used by validation reporting and the UI. */
  subjectEntityIds?: string[]
  /** Who is deliberately in front of the lens (an over-the-shoulder anchor). */
  foregroundEntityIds?: string[]
}

export interface Scene3DClayLighting {
  preset: Scene3DClayLightingPreset
  ambientIntensity: number
  keyIntensity: number
  keyPosition: Vec3
}

/** Which space a constant transform override is expressed in. Declared, so the
 *  renderer never multiplies the same parent transform in twice. */
export type Scene3DOverrideSpace = "local" | "world"

interface Scene3DOverrideProvenance {
  id: string
  /** The revision this override was authored against. */
  sourceRevisionId: string
  /** That revision's canonical content hash when the override was authored. */
  sourceContentHash: string
  operationVersion: number
}

export type Scene3DOverride = Scene3DOverrideProvenance &
  (
    | { kind: "entity-transform"; entityId: string; space: Scene3DOverrideSpace; position?: Vec3; rotation?: Vec3; scale?: Vec3 }
    | { kind: "entity-color"; entityId: string; materialRole: string; color: string }
    | { kind: "entity-visibility"; entityId: string; visible: boolean }
    | { kind: "camera-shot-offset"; shotId: string; positionOffset?: Vec3; targetOffset?: Vec3 }
  )

/**
 * Who built this revision and from what. Source versioning and renderer
 * versioning are independent — a renderer upgrade does not invalidate a scene.
 *
 * Every string here is a bounded slug, which is a structural guarantee that no
 * native path or block of prose fits in one. Scrubbing credentials
 * out of the values it does accept remains the producer's duty.
 */
export interface Scene3DProvenance {
  engine: string
  engineVersion: string
  recipeVersion: string
  compilerVersion: string
  exporterVersion: string
  rendererVersion: string
  sourceRevisionId?: string
  /** The retained `blend-source` asset, when one was kept. */
  sourceArtifactId?: string
  /** Canonical content hash of this revision — see `scene3d-v2-resources.ts`. */
  contentHash: string
}

export interface Scene3DPlanV2 {
  planType: typeof SCENE3D_PLAN_TYPE
  schemaVersion: typeof SCENE3D_SCHEMA_VERSION_V2
  revisionId: string
  parentRevisionId?: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  units: "meters"
  upAxis: "Y"
  handedness: "right"
  objects: Scene3DEntityV2[]
  assets: Scene3DAssetRef[]
  cameraTrackAssetId: string
  shots: Scene3DShot[]
  lighting: Scene3DClayLighting
  backgroundColor: string
  references?: Scene3DReference[]
  overrides?: Scene3DOverride[]
  provenance: Scene3DProvenance
}

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

/** Opaque storage id. Deliberately slash-free: an asset id is an ID, resolved
 *  server-side against ownership — never a path and never a URL. */
export const scene3DAssetIdSchema = z
  .string()
  .min(1)
  .max(SCENE3D_V2_LIMITS.maxAssetIdLength)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "assetId must be an opaque id (letters, digits, '_', '-', '.', ':')")
  .refine((value) => !value.includes(".."), "assetId must not contain '..'")

/** A node name inside an exported GLB. */
export const scene3DNodeIdSchema = z
  .string()
  .min(1)
  .max(SCENE3D_V2_LIMITS.maxNodeIdLength)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "node id must be an exporter-generated stable id")

export const scene3DSha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters")

/**
 * A version/engine token. The charset excludes `/`, `\`, `:` and whitespace, so
 * a native filesystem path cannot be spelled as one; the 64-character cap
 * excludes prose.
 */
export const scene3DVersionTokenSchema = z
  .string()
  .min(1)
  .max(SCENE3D_V2_LIMITS.maxVersionLength)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/,
    "version must be a bounded token (letters, digits, '_', '-', '.', '+') — never a path or prose",
  )

export const scene3DEngineIdSchema = z
  .string()
  .min(1)
  .max(SCENE3D_V2_LIMITS.maxVersionLength)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "engine must be a lowercase slug such as blender-cloud")

/** Anchor names and material roles share the id charset (dots allowed, so
 *  `wheel.frontLeft` is one name and not a path). */
export const scene3DAnchorNameSchema = scene3DIdSchema
export const scene3DMaterialRoleSchema = scene3DIdSchema

export const scene3DMaterialNameSchema = z
  .string()
  .min(1)
  .max(SCENE3D_V2_LIMITS.maxMaterialNameLength)
  // A GLB material name is authored text, so the charset is wide — but control
  // characters are never legitimate and are how a log line gets forged.
  .regex(/^[^\u0000-\u001f\u007f]+$/, "material name must not contain control characters")

const v2FrameSchema = z.number().int().min(0).max(SCENE3D_V2_LIMITS.maxDurationInFrames)

export const scene3DEntityCapabilitySchema = z.enum(["transform", "color", "visibility"])

export const scene3DAnchorSchema = z
  .object({
    name: scene3DAnchorNameSchema,
    position: vec3Schema,
    rotation: rotationVec3Schema.optional(),
  })
  .strict()

export const scene3DMaterialBindingSchema = z
  .object({
    role: scene3DMaterialRoleSchema,
    materialName: scene3DMaterialNameSchema,
    color: scene3DColorSchema.optional(),
    roughness: z.number().min(0).max(1).optional(),
  })
  .strict()

export const scene3DAssetAnimationSchema = z
  .object({
    clipName: z.string().min(1).max(SCENE3D_V2_LIMITS.maxNameLength),
    startFrame: v2FrameSchema,
    endFrameExclusive: z.number().int().min(1).max(SCENE3D_V2_LIMITS.maxDurationInFrames),
    loop: z.boolean().optional(),
  })
  .strict()

export const scene3DEntityVisualSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group") }).strict(),
  z
    .object({
      kind: z.literal("primitive"),
      primitive: z.enum(["box", "sphere", "cylinder", "cone", "plane", "capsule"]),
      dimensions: sizeVec3Schema,
      color: scene3DColorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset"),
      assetId: scene3DAssetIdSchema,
      rootNodeId: scene3DNodeIdSchema,
      animation: scene3DAssetAnimationSchema.optional(),
    })
    .strict(),
])

export const scene3DEntityV2Schema = z
  .object({
    id: scene3DIdSchema,
    name: z.string().min(1).max(SCENE3D_V2_LIMITS.maxNameLength),
    parentId: scene3DIdSchema.optional(),
    role: z.enum(["person", "vehicle", "prop", "environment", "other"]).optional(),
    position: vec3Schema.optional(),
    rotation: rotationVec3Schema.optional(),
    scale: scaleVec3Schema.optional(),
    identityColor: scene3DColorSchema.optional(),
    anchors: z.array(scene3DAnchorSchema).max(SCENE3D_V2_LIMITS.maxAnchorsPerEntity).optional(),
    capabilities: z.array(scene3DEntityCapabilitySchema).max(SCENE3D_ENTITY_CAPABILITIES.length).optional(),
    locks: z.array(scene3DEntityCapabilitySchema).max(SCENE3D_ENTITY_CAPABILITIES.length).optional(),
    materialBindings: z
      .array(scene3DMaterialBindingSchema)
      .max(SCENE3D_V2_LIMITS.maxMaterialBindingsPerEntity)
      .optional(),
    visual: scene3DEntityVisualSchema,
  })
  .strict()

export const scene3DAssetRefSchema = z
  .object({
    assetId: scene3DAssetIdSchema,
    kind: z.enum(["glb", "camera-track-json", "poster", "validation-report", "blend-source"]),
    role: z.enum(["scene-geometry", "entity-geometry", "camera-track", "poster", "validation-report", "source"]),
    byteLength: z.number().int().min(1).max(SCENE3D_V2_LIMITS.maxBlendSourceBytes),
    sha256: scene3DSha256Schema,
    originRevisionId: z.uuid().optional(),
  })
  .strict()

export const scene3DShotSchema = z
  .object({
    id: scene3DIdSchema,
    startFrame: v2FrameSchema,
    endFrameExclusive: z.number().int().min(1).max(SCENE3D_V2_LIMITS.maxDurationInFrames),
    label: z.string().min(1).max(SCENE3D_V2_LIMITS.maxLabelLength).optional(),
    subjectEntityIds: z.array(scene3DIdSchema).max(SCENE3D_V2_LIMITS.maxShotEntityIds).optional(),
    foregroundEntityIds: z.array(scene3DIdSchema).max(SCENE3D_V2_LIMITS.maxShotEntityIds).optional(),
  })
  .strict()

export const scene3DClayLightingSchema = z
  .object({
    preset: z.enum(SCENE3D_CLAY_LIGHTING_PRESETS),
    ambientIntensity: z.number().min(0).max(SCENE3D_V2_LIMITS.maxIntensity),
    keyIntensity: z.number().min(0).max(SCENE3D_V2_LIMITS.maxIntensity),
    keyPosition: vec3Schema,
  })
  .strict()

const overrideProvenanceShape = {
  id: scene3DIdSchema,
  sourceRevisionId: z.uuid(),
  sourceContentHash: scene3DSha256Schema,
  operationVersion: z.number().int().min(1).max(255),
}

export const scene3DOverrideSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...overrideProvenanceShape,
      kind: z.literal("entity-transform"),
      entityId: scene3DIdSchema,
      space: z.enum(["local", "world"]),
      position: vec3Schema.optional(),
      rotation: rotationVec3Schema.optional(),
      scale: scaleVec3Schema.optional(),
    })
    .strict(),
  z
    .object({
      ...overrideProvenanceShape,
      kind: z.literal("entity-color"),
      entityId: scene3DIdSchema,
      materialRole: scene3DMaterialRoleSchema,
      color: scene3DColorSchema,
    })
    .strict(),
  z
    .object({
      ...overrideProvenanceShape,
      kind: z.literal("entity-visibility"),
      entityId: scene3DIdSchema,
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...overrideProvenanceShape,
      kind: z.literal("camera-shot-offset"),
      shotId: scene3DIdSchema,
      positionOffset: vec3Schema.optional(),
      targetOffset: vec3Schema.optional(),
    })
    .strict(),
])

export const scene3DProvenanceSchema = z
  .object({
    engine: scene3DEngineIdSchema,
    engineVersion: scene3DVersionTokenSchema,
    recipeVersion: scene3DVersionTokenSchema,
    compilerVersion: scene3DVersionTokenSchema,
    exporterVersion: scene3DVersionTokenSchema,
    rendererVersion: scene3DVersionTokenSchema,
    sourceRevisionId: z.uuid().optional(),
    sourceArtifactId: scene3DAssetIdSchema.optional(),
    contentHash: scene3DSha256Schema,
  })
  .strict()
// ---------------------------------------------------------------------------
// JSON admission helpers
// ---------------------------------------------------------------------------

type Issue = Scene3DSemanticIssue

/** Decoded byte length of a JSON payload, browser and Node alike. Size is
 *  checked on the BYTES, before `JSON.parse` allocates anything. */
export function scene3DJsonByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** What every `parse…Json` admission helper returns: the value, or the issues
 *  that stopped it — never a throw, so a route can map issues to a 400. */
export type Scene3DParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] }

/** Flattens a zod failure into the same issue shape the semantic validators use. */
export function scene3DZodIssues(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({ path: [...issue.path] as (string | number)[], message: issue.message }))
}
