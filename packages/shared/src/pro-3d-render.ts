/**
 * The `pro-3d-render` ("3D Render Pro") WIRE CONTRACT.
 *
 * ONE durable operation, three ways in. A `source` says WHERE the scene comes
 * from — a new brief, an existing revision, or a completed desktop export —
 * and the settled job carries BOTH halves of the result: the exact composition
 * (`scenePlan`) and the standard video field every downstream consumer already
 * reads (`videoUrl`).
 *
 * The `source` is a strict discriminated union rather than a bag of optional
 * fields, and that is the load-bearing decision here. "Prompt present" and
 * "revisionId present" are not two settings on one request: they select
 * different pipelines with different costs. A flat shape lets a caller send
 * both, or neither, and pushes the "what did they actually mean" decision into
 * whichever surface reads it last — which is how an existing scene silently
 * becomes a paid re-authoring run.
 *
 * The same union is what makes RENDER-ONLY expressible: `{kind:'scene'}` with
 * NO `editPrompt` means "export this revision", and its absence must survive
 * every hop unchanged. Nothing may helpfully substitute an empty string or
 * copy the node's brief into it — that converts a free export into an
 * authoring run the user never asked for.
 *
 * What lives here is only what a client needs to CALL the operation, QUOTE it
 * and READ its result. How the scene is planned, compiled, built, priced or
 * authorized is not part of this contract and is not described here.
 *
 * Deliberately NOT here:
 *  - a model chooser. The planner is fixed and server-owned.
 *  - a credit number. The cost is resolved server-side and returned by the
 *    quote endpoint; a constant in a published package would be a wrong answer
 *    shipped to every consumer (see `PRO3D_RENDER_CREDIT_ID`).
 */
import { z } from "zod"
import { SCENE3D_LIMITS, type Scene3DReference } from "./scene3d.js"
import { scene3DAnyPlanSchema, type Scene3DPlan } from "./scene3d-v2-plan.js"
import { scene3DInputAssetsSchema, type Scene3DInputAsset } from "./scene3d-input-assets.js"

/** Canvas/API/MCP node type. */
export const PRO3D_RENDER_NODE_TYPE = "pro-3d-render"

/** Display name. One string, so every surface spells it the same way. */
export const PRO3D_RENDER_LABEL = "3D Render Pro"

/**
 * The credit identifier the operation settles under.
 *
 * An IDENTIFIER, not a price: the number is operator/deployment configuration
 * (a `model_pricing` row), and the per-run ceiling comes from a quote. There is
 * deliberately no fallback constant — a flat default would underprice an
 * operation that plans, builds and renders, and "cheap by accident" is not a
 * failure mode you notice from the outside.
 */
export const PRO3D_RENDER_CREDIT_ID = "pro-3d-render"

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Where the scene is built. `blender-local` is a paired desktop and is refused
 * unless the deployment both enables it and has an engine advertising it — an
 * unknown or unavailable engine is an error, never a downgrade to the cheaper
 * cloud path.
 */
export const PRO3D_RENDER_ENGINES = ["blender-cloud", "blender-local"] as const
export type Pro3DRenderEngine = (typeof PRO3D_RENDER_ENGINES)[number]
export const PRO3D_RENDER_DEFAULT_ENGINE: Pro3DRenderEngine = "blender-cloud"

/**
 * Render quality profiles.
 *
 * One today. A surface must advertise only what the installed engine reports
 * (`capabilities().pro.qualityProfiles`) rather than this list — offering a
 * profile the engine cannot serve is a run that fails after the user chose it.
 */
export const PRO3D_RENDER_QUALITY_PROFILES = ["standard"] as const
export type Pro3DRenderQuality = (typeof PRO3D_RENDER_QUALITY_PROFILES)[number]
export const PRO3D_RENDER_DEFAULT_QUALITY: Pro3DRenderQuality = "standard"

/** Material/lighting treatment. Clay is the movement-reference default. */
export const PRO3D_RENDER_STYLES = ["clay"] as const
export type Pro3DRenderStyle = (typeof PRO3D_RENDER_STYLES)[number]
export const PRO3D_RENDER_DEFAULT_STYLE: Pro3DRenderStyle = "clay"

/**
 * The correction budget: how many repair passes the engine may spend after its
 * first attempt. Displayed to the user because each pass is paid work.
 */
export const PRO3D_RENDER_MIN_REPAIR_PASSES = 0
export const PRO3D_RENDER_MAX_REPAIR_PASSES = 2
export const PRO3D_RENDER_DEFAULT_REPAIR_PASSES = 2

/**
 * Aspect ratios the node authors at.
 *
 * `21:9` is not decoration: the acceptance fixture is a 30-second 21:9 scene,
 * so a set that omitted it could not express the case the feature is measured
 * against. Its canonical pixel pair is the contract's explicitly supported
 * 1680×720 (see `ASPECT_RATIO_DIMENSIONS`).
 */
export const PRO3D_RENDER_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5", "21:9"] as const
export type Pro3DRenderAspectRatio = (typeof PRO3D_RENDER_ASPECT_RATIOS)[number]

/** Same prompt ceiling the Basic authoring routes enforce. */
export const PRO3D_RENDER_PROMPT_MAX = 8000

/**
 * Request bounds shared by every ingress (HTTP route, orchestrator, MCP, SDK).
 *
 * Timing/reference limits reuse the Basic authoring limits verbatim rather
 * than declaring a second set: the two nodes describe the same kind of scene,
 * and two drifting ceilings is how one surface starts accepting what another
 * refuses.
 */
export const PRO3D_RENDER_LIMITS = {
  promptMax: PRO3D_RENDER_PROMPT_MAX,
  editPromptMax: PRO3D_RENDER_PROMPT_MAX,
  minDurationSeconds: SCENE3D_LIMITS.minDurationSeconds,
  maxDurationSeconds: SCENE3D_LIMITS.maxDurationSeconds,
  minFps: SCENE3D_LIMITS.minFps,
  maxFps: SCENE3D_LIMITS.maxFps,
  maxReferences: SCENE3D_LIMITS.maxReferences,
  /** Opaque ids the caller echoes back (quote, export, connection). */
  maxIdLength: 200,
  /** `Idempotency-Key` bounds — the platform's floor, with a ceiling so an
   *  unbounded header can never reach a lookup or a database column. */
  minIdempotencyKeyLength: 8,
  maxIdempotencyKeyLength: 255,
} as const

// ---------------------------------------------------------------------------
// The source union
// ---------------------------------------------------------------------------

export const PRO3D_RENDER_SOURCE_KINDS = ["prompt", "scene", "local-export"] as const
export type Pro3DRenderSourceKind = (typeof PRO3D_RENDER_SOURCE_KINDS)[number]

/** A new scene, authored from a brief plus optional image/video references. */
export interface Pro3DRenderPromptSource {
  kind: "prompt"
  prompt: string
  references?: readonly Scene3DReference[]
  inputAssets?: readonly Scene3DInputAsset[]
}

/**
 * An existing immutable revision.
 *
 * `editPrompt` ABSENT is the render-only path — export this revision, spend no
 * authoring or build credits. Its absence is meaningful and must be preserved
 * verbatim; an empty string is not the same request.
 *
 * Retained revisions are authorized through their current scene permissions.
 * `sourceJobId` locates Basic scenes stored only in job history; it is required
 * for that source, but optional for retained scenes (including manual edits).
 */
export interface Pro3DRenderSceneSource {
  kind: "scene"
  revisionId: string
  sourceJobId?: string
  editPrompt?: string
}

/** A completed export from a paired desktop Blender. */
export interface Pro3DRenderLocalExportSource {
  kind: "local-export"
  exportId: string
  connectionId: string
}

export type Pro3DRenderSource =
  | Pro3DRenderPromptSource
  | Pro3DRenderSceneSource
  | Pro3DRenderLocalExportSource

/** True when this source exports an existing revision without re-authoring it. */
export function isPro3DRenderRenderOnly(source: Pro3DRenderSource): boolean {
  return source.kind === "scene" && source.editPrompt === undefined
}

/**
 * Which scene-schema version a source PRODUCES, or `null` when only the server
 * can know.
 *
 * A `prompt` or `local-export` source always mints a fresh v2 manifest, so a
 * client that cannot read v2 is refusable for free, before any work. A `scene`
 * source inherits whatever version the named revision already is — the host
 * does not resolve revisions, so demanding v2 there would refuse a perfectly
 * renderable retained v1 scene.
 */
export function pro3DRenderProducedSchemaVersion(source: Pro3DRenderSource): number | null {
  return source.kind === "scene" ? null : 2
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

/** One priced component of a quote. Display copy, not economics. */
export interface Pro3DRenderQuoteLine {
  code: string
  label: string
  credits: number
}

/**
 * The paired quote's answer.
 *
 * `maxCredits` is a CEILING, not a charge: quoting reserves nothing and spends
 * nothing. `normalizedInputHash` is what run admission re-checks, so a body
 * edited between quote and run is refused rather than executed at a price it
 * was never quoted for.
 */
export interface Pro3DRenderQuote {
  quoteId: string
  /** ISO-8601. After this the quote is stale and run answers "quote again". */
  expiresAt: string
  maxCredits: number
  breakdown: Pro3DRenderQuoteLine[]
  pricingVersion: string
  capabilitiesVersion: string
  normalizedInputHash: string
}

export const pro3DRenderQuoteSchema = z
  .object({
    quoteId: z.string().min(1),
    expiresAt: z.string().min(1),
    maxCredits: z.number(),
    breakdown: z.array(
      z.object({ code: z.string(), label: z.string(), credits: z.number() }).passthrough(),
    ),
    pricingVersion: z.string(),
    capabilitiesVersion: z.string(),
    normalizedInputHash: z.string().min(1),
  })
  .passthrough()

export function isPro3DRenderQuote(value: unknown): value is Pro3DRenderQuote {
  return pro3DRenderQuoteSchema.safeParse(value).success
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * What this deployment can actually serve.
 *
 * Every surface that offers a control reads it from here rather than from the
 * vocabularies above: the constants say what the CONTRACT can express, this
 * says what the INSTALLED engine will accept.
 */
export interface Pro3DRenderCapabilities {
  available: boolean
  engines: Pro3DRenderEngine[]
  qualityProfiles: Pro3DRenderQuality[]
  styles: Pro3DRenderStyle[]
  aspectRatios: Pro3DRenderAspectRatio[]
  maxRepairPasses: number
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface Pro3DRenderValidationWarning {
  code: string
  message: string
  shotId?: string
}

/**
 * One still per shot of the exported composition.
 *
 * A render's contact sheet: the frame a shot OPENS on, which is the frame that
 * says what the shot is of. `shotIndex` is the 0-based position in the v2
 * composition's `shots` array — a v1 (single-shot) scene has exactly one still,
 * index 0 at frame 0 — and `frame` is that shot's own first frame in the
 * composition's frame space, so a caller can line a still up against the MP4
 * without re-deriving shot boundaries.
 */
export interface Pro3DRenderShotStill {
  shotIndex: number
  frame: number
  assetId: string
  url: string
}

export interface Pro3DRenderResultMetadata {
  width: number
  height: number
  fps: number
  frames: number
  duration: number
}

/**
 * The completed job's `output_data`.
 *
 * `videoUrl` is the platform's existing resolved-video field (the contract's
 * `resultUrl` mapped onto the envelope this platform already has), so the node
 * connects to every existing video consumer without a second video result type
 * producer validators cannot parse. `scenePlan` + `sceneRevisionId` are the
 * exact revision that video was rendered from, so a later render-only re-run
 * costs no authoring.
 *
 * Everything else is what the spec requires a caller to be able to act on: the
 * poster to show before playback, the validation report to read warnings from,
 * the renderer/metadata to check the export against a downstream model's
 * limits, and the optional source artifact to offer as a download.
 */
export interface Pro3DRenderJobOutput {
  videoUrl: string
  scenePlan: Scene3DPlan
  sceneRevisionId: string
  posterAssetId: string
  /**
   * One still per shot, ordered by `shotIndex`. Optional and additive: a
   * runtime that does not render stills yet returns a complete result without
   * them, and a result that HAS them has one for every shot.
   */
  shotStills?: Pro3DRenderShotStill[]
  /** Present when an editable native source was retained for this revision. */
  sourceArtifactId?: string
  validation: {
    status: "passed"
    reportAssetId: string
    warnings: Pro3DRenderValidationWarning[]
  }
  renderer: string
  metadata: Pro3DRenderResultMetadata
  /** Short, user-safe note about what this revision contains. Never diagnostics. */
  changeSummary?: string
}

/**
 * Reader-side schema.
 *
 * Passthrough on purpose: a job row may carry additive metadata a client of
 * this version has never heard of, and refusing the whole result over an
 * unknown key would turn an additive server change into a client outage.
 *
 * The required fields are required because the contract makes them so — this
 * is what a COMPLETE result looks like. Nothing in the platform fabricates
 * them to satisfy the schema; a runtime that has not produced them yet simply
 * does not parse as complete, which is the honest answer.
 */
export const pro3DRenderShotStillSchema = z
  .object({
    shotIndex: z.number().int().min(0),
    frame: z.number().int().min(0),
    assetId: z.string().min(1),
    url: z.string().min(1),
  })
  .passthrough()

export const pro3DRenderJobOutputSchema = z
  .object({
    videoUrl: z.string().min(1),
    scenePlan: scene3DAnyPlanSchema,
    sceneRevisionId: z.string().min(1),
    posterAssetId: z.string().min(1),
    shotStills: z.array(pro3DRenderShotStillSchema).optional(),
    sourceArtifactId: z.string().min(1).optional(),
    validation: z
      .object({
        status: z.literal("passed"),
        reportAssetId: z.string().min(1),
        warnings: z.array(
          z
            .object({
              code: z.string(),
              message: z.string(),
              shotId: z.string().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    renderer: z.string().min(1),
    metadata: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
        frames: z.number().int().positive(),
        duration: z.number().positive(),
      })
      .passthrough(),
    changeSummary: z.string().optional(),
  })
  .passthrough()

export function isPro3DRenderJobOutput(value: unknown): value is Pro3DRenderJobOutput {
  return pro3DRenderJobOutputSchema.safeParse(value).success
}

/**
 * The stills on a result, in shot order — the ONE reader every surface uses.
 *
 * Tolerant on purpose: this runs on canvas node data, on a job row read back
 * from the database and on an MCP result envelope, and in every one of those a
 * missing or malformed list means "this result has no stills", never "refuse
 * the whole result". Sorting here is what lets `shotStills[i]` mean shot `i`
 * at every call site without each one remembering to sort.
 */
export function pro3DRenderShotStills(output: unknown): Pro3DRenderShotStill[] {
  const list = (output as { shotStills?: unknown } | null | undefined)?.shotStills
  if (!Array.isArray(list)) return []
  const parsed = list.flatMap((entry) => {
    const result = pro3DRenderShotStillSchema.safeParse(entry)
    return result.success
      ? [{ shotIndex: result.data.shotIndex, frame: result.data.frame,
          assetId: result.data.assetId, url: result.data.url }]
      : []
  })
  return parsed.sort((a, b) => a.shotIndex - b.shotIndex)
}

/**
 * The two fields every EXECUTION SURFACE must be able to resolve, whatever
 * else a runtime does or does not attach yet.
 *
 * Separate from the full reader above on purpose: canvas wiring, the DAG
 * extractors and the render-only re-run need "is there a video and a scene
 * here", and gating those on complete metadata would blank a node over a
 * missing poster id.
 */
export const pro3DRenderCoreOutputSchema = z
  .object({
    videoUrl: z.string().min(1),
    scenePlan: scene3DAnyPlanSchema,
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Source construction, shared by every execution surface
// ---------------------------------------------------------------------------

/** What a canvas node / DAG builder holds before it can name a source. */
export interface Pro3DRenderSourceInput {
  inputAssets?: readonly Scene3DInputAsset[]
  /** `"scene"` selects the existing-revision path; anything else is a brief. */
  sourceMode?: string
  /** The brief, already resolved and affix-applied by the caller. */
  prompt?: string
  references?: readonly Scene3DReference[]
  /** The revision to export or edit, and the run that produced it. */
  revisionId?: string
  sourceJobId?: string
  /** Absent/blank keeps the render-only path. */
  editPrompt?: string
}

export type Pro3DRenderSourceResult =
  | { ok: true; source: Pro3DRenderSource }
  | { ok: false; message: string }

/**
 * Turn node/DAG state into the wire `source`.
 *
 * Shared by BOTH execution engines because the alternative — one copy in the
 * browser executor and one in the orchestrator — is the drift that lets a
 * canvas run and a headless run of the same node mean different things. The
 * refusals are part of that: a scene source missing its correlation must fail
 * the same way on both.
 *
 * A blank `editPrompt` is treated as ABSENT, never as an empty instruction: a
 * user who cleared the box asked for a plain export, and forwarding `""` would
 * buy them an authoring pass.
 */
export function buildPro3DRenderSource(input: Pro3DRenderSourceInput): Pro3DRenderSourceResult {
  if (input.sourceMode === "scene") {
    const revisionId = input.revisionId?.trim()
    const sourceJobId = input.sourceJobId?.trim()
    if (!revisionId) {
      return { ok: false, message: "no scene to render — wire a 3D scene in, or run this node once." }
    }
    const editPrompt = input.editPrompt?.trim()
    return {
      ok: true,
      source: { kind: "scene", revisionId, ...(sourceJobId ? { sourceJobId } : {}), ...(editPrompt ? { editPrompt } : {}) },
    }
  }
  const prompt = input.prompt?.trim()
  if (!prompt) {
    return { ok: false, message: "no brief — describe the scene, or wire a prompt in." }
  }
  const references = input.references ?? []
  const parsedAssets = scene3DInputAssetsSchema.safeParse(input.inputAssets ?? [])
  if (!parsedAssets.success) return { ok: false, message: "invalid scene input assets" }
  return {
    ok: true,
    source: { kind: "prompt", prompt, ...(references.length > 0 ? { references } : {}),
      ...(parsedAssets.data.length ? { inputAssets: parsedAssets.data } : {}) },
  }
}

/**
 * Which timing fields a request may carry.
 *
 * A `scene` source already HAS timing, and the contract forbids silently
 * overriding it — so the node's own duration/fps/aspect are withheld unless
 * the user explicitly asked to re-time, in which case they are sent and the
 * engine decides whether the change is compatible. For a new scene the node's
 * settings simply are the request.
 *
 * Returning an object with the keys omitted (rather than set to `undefined`)
 * matters: these bodies are JSON-serialized, and an explicit `undefined` and a
 * missing key are the same on the wire only by luck of the serializer.
 */
export function pro3DRenderTimingOverrides(input: {
  source: Pro3DRenderSource
  overrideSourceTiming?: boolean
  durationSeconds?: number
  fps?: number
  aspectRatio?: string
}): { durationSeconds?: number; fps?: number; aspectRatio?: string } {
  if (input.source.kind === "scene" && !input.overrideSourceTiming) return {}
  const out: { durationSeconds?: number; fps?: number; aspectRatio?: string } = {}
  if (typeof input.durationSeconds === "number") out.durationSeconds = input.durationSeconds
  if (typeof input.fps === "number") out.fps = input.fps
  if (typeof input.aspectRatio === "string") out.aspectRatio = input.aspectRatio
  return out
}
