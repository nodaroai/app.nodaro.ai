/**
 * Nodaro Motion's preparation steps (`steps`): the vocabulary and the settings
 * shape the Cast Swap engine owns, mirrored here WITHOUT any text (pure, no
 * database). An admin sets them per trend (`TrendVersionData.steps`) and per
 * engine for direct runs (`nodaro_motion_steps`, `nodaro-motion-steps.ts`):
 *
 * - `sheets`: each role's photos are labelled by an LLM, and a rules table per
 *   kind maps what the photos cover (`SHEET_CONDITIONS`) to a layout
 *   (`SHEET_LAYOUTS`). Absent = today's sheet per kind, no labelling.
 * - `enginePrompt`: Template (today) or an LLM that writes the prompt body.
 * - `sceneDescription`: Template (no call) or an LLM with its own config.
 *   Absent = today's call.
 * - `clipBody` ("Body from the clip"): on / off, with an optional image
 *   prompt in place of the engine's default. For a person role whose Outfit
 *   is new and whose Body or Hair is from the clip, the role's reference is
 *   redrawn from a frame of the clip. Absent = the engine's own default
 *   (Off on an engine whose steps defaults answer `clipBody.mode`, On on an
 *   earlier one), so it is stored and sent only when an admin set it, and only
 *   to an engine that declares `castSwap.clipBodySheet` (`stepsForEngine`).
 * - `shotList` (the shot list: the scene description written shot by shot,
 *   per STYLE): `{ precise?: { mode, llm? }, flex?: { mode, llm? } }`. Absent
 *   = Precise off, Flex on with the engine's defaults; Flex is always on
 *   (`flex.mode` "off" is refused, `shot_list_flex_always_on`). Sent only to
 *   an engine that declares `castSwap.shotList` (`stepsForEngine`); the
 *   defaults need no engine (`shotListNeedsEngine`).
 *
 * Every step here is non-critical: a failure is skipped (`skippedSteps`), the
 * run goes on. A setting left unset (or empty, `{}`) is today's run exactly:
 * `stepsSet` is the one test of "is anything set", so an empty object is never
 * stored, sent or counted as a need.
 *
 * The default texts (instructions, layout prompts) are the engine's and stay
 * in it: the admin reads them at run time through the engine's steps route.
 *
 * Two schemas: `castSwapStepsSchema` reads what is stored (a model is any
 * string, so a model later removed from the list never breaks a saved
 * version), and `castSwapStepsSaveSchema` checks what an admin saves (the
 * model must be a known one that can see what it is shown).
 */
import { createHash } from "node:crypto"
import { z } from "zod"
import { getLlmModalityCaps, LLM_MODEL_IDS } from "@nodaro/shared/llm-models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

// ---- 0.1 Vocabulary --------------------------------------------------------

export const SHEET_KINDS = ["person", "pet", "product", "location"] as const
export type SheetKind = (typeof SHEET_KINDS)[number]

/** What a role's photos cover, from the labels: a fixed list. */
export const SHEET_CONDITIONS = ["head-body", "body-only", "head-only", "unclear"] as const
export type SheetCondition = (typeof SHEET_CONDITIONS)[number]

/** The layouts per kind, in the design's numbering (index 0 = layout 1), then "none" (raw photos, no sheet). */
export const SHEET_LAYOUTS = {
  person: ["collage", "head-body", "head-body-cut", "head-3q-body-cut", "head-3q-front-back-cut", "none"],
  pet: ["collage", "head-body", "head-body-side", "head-3q-body", "head-3q-side-back", "none"],
  product: ["collage", "front-3q", "turnaround", "none"],
  location: ["collage", "wide-detail", "none"],
} as const
export type SheetLayout<K extends SheetKind = SheetKind> = (typeof SHEET_LAYOUTS)[K][number]

/** Today's sheet per kind: the layout an unset setting uses. */
export const TODAY_LAYOUT = { person: "head-body", pet: "head-body-side", product: "turnaround", location: "none" } as const

/** What an LLM step may be shown. */
export const LLM_INPUTS = ["clip", "rolePhotos", "references", "extraPrompt"] as const
export type LlmInput = (typeof LLM_INPUTS)[number]

/** The steps a run may go on without (`skippedSteps[].step`). */
export const SKIPPABLE_STEPS = ["face-mesh", "photo-labels", "head-crop", "reference-sheet", "engine-prompt", "scene-description", "clip-body"] as const
export type SkippableStep = (typeof SKIPPABLE_STEPS)[number]
export const SKIP_REASONS = ["failed", "timed_out", "frame_count_mismatch", "invalid_output", "too_long", "unavailable", "no_face", "no_frame"] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

/** One step a run went on without; `role` is its index in the run's roles. */
export interface SkippedStep {
  step: SkippableStep
  reason: SkipReason
  role?: number
}

/**
 * The models that read the clip only as an IMAGE reference (the clip passed
 * as a picture): the engine sends it so for these, and through a video
 * reference to a model that takes video.
 */
export const CLIP_AS_IMAGE_MODELS = ["gemini-3.8-flash"] as const

/** The inputs that put pictures in front of the model. */
const PICTURE_INPUTS: readonly LlmInput[] = ["clip", "rolePhotos", "references"]

// ---- 0.4 The step outputs record --------------------------------------------

export interface PhotoLabel {
  index: number
  subject: "person" | "animal" | "product" | "place" | "other"
  framing: "head" | "body"
  angle: "front" | "three-quarter" | "side" | "back"
  quality: "ok" | "low"
}

/** What a run with `steps` recorded of each step (server-only, `__castSwapStepOutputs`). */
export interface StepOutputs {
  v: 1
  roles: Array<{
    role: number
    kind: SheetKind
    labels?: PhotoLabel[]
    condition?: SheetCondition
    layout?: SheetLayout
    sheetUrl?: string
    /** A kept sheet served again (a cache hit). */
    kept?: boolean
    /** "Body from the clip": the frame picked for the role and the sheet redrawn from it. */
    clipBody?: ClipBodyOutput
  }>
  enginePrompt?: { mode: "template" | "llm"; text?: string }
  /** `shotList`: the run made its shot list (the style's step); `cuts`: the cut times (s) it was told (absent: none measured). */
  scene?: { mode: "template" | "llm"; shotList?: true; cuts?: number[] }
}

/** What the clip-body step recorded for one role. */
export interface ClipBodyOutput {
  /** The frame of the clip picked for the role (a picture). */
  frameUrl?: string
  /** Where that frame is in the clip (seconds). */
  frameSec?: number
  /** The reference sheet redrawn from the frame and the role's reference. */
  sheetUrl?: string
  /** The image prompt it was drawn with. */
  prompt?: string
}

// ---- 0.2 The settings shape ------------------------------------------------

/** The codes of the settings' own refusals (`params.castSwapCode`). */
export type CastSwapStepsCode =
  | "labeller_inputs"
  | "scene_needs_clip"
  | "duplicate_input"
  | "unknown_model"
  | "model_cannot_see_images"
  | "model_cannot_read_clip"
  | "clip_body_placeholder"
  | "shot_list_flex_always_on"

export interface LlmStepSetting {
  model: string
  /** The system prompt; absent = the engine's default. */
  instructions?: string
  inputs: LlmInput[]
  /** The longest text it may write (the run caps it further). */
  maxChars: number
}

export type TextStepSetting = { mode: "template" } | { mode: "llm"; llm: LlmStepSetting }

export type SheetRules = { [K in SheetKind]: Record<SheetCondition, SheetLayout<K>> }

/** The longest image prompt the clip-body step may be given. */
export const CLIP_BODY_PROMPT_MAX = 4000

/** The placeholders the clip-body image prompt may name (the engine fills them per role); no other `{word}`. */
export const CLIP_BODY_PLACEHOLDERS = ["subject", "body", "hair"] as const

/** The `{word}` placeholders in `prompt` that are not `CLIP_BODY_PLACEHOLDERS` (exact case), each once, in order. */
export function unknownClipBodyPlaceholders(prompt: string): string[] {
  const names = [...prompt.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((m) => m[1]!)
  return [...new Set(names.filter((n) => !(CLIP_BODY_PLACEHOLDERS as readonly string[]).includes(n)))]
}

/** "Body from the clip": absent = the engine's default (see the header). `prompt` replaces the engine's prompt. */
export interface ClipBodySetting {
  mode: "on" | "off"
  prompt?: string
}

/** The shot list's step for one style: on or off, and its LLM (absent: the engine's default). */
export interface ShotListStyleSetting {
  mode: "on" | "off"
  llm?: LlmStepSetting
}

/** The styles a shot list is set per (a direct run's `style`; "flex" is the person's name for "motion"). */
export const SHOT_LIST_STYLES = ["precise", "flex"] as const
export type ShotListStyle = (typeof SHOT_LIST_STYLES)[number]

/** The shot list per style. Absent (either style): Precise off, Flex on, with the engine's defaults. */
export type ShotListSetting = { [S in ShotListStyle]?: ShotListStyleSetting }

export interface CastSwapSteps {
  sheets?: { labeller?: LlmStepSetting; rules: SheetRules }
  enginePrompt?: TextStepSetting
  sceneDescription?: TextStepSetting
  clipBody?: ClipBodySetting
  shotList?: ShotListSetting
}

const llmStepSchema = z.strictObject({
  model: z.string().min(1).max(100),
  instructions: z.string().trim().min(1).max(8000).optional(),
  inputs: z.array(z.enum(LLM_INPUTS)).max(4),
  maxChars: z.int().min(200).max(20_000),
})

const textStepSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("template") }),
  z.strictObject({ mode: z.literal("llm"), llm: llmStepSchema }),
])

function rowsOf<K extends SheetKind>(kind: K) {
  const layout = z.enum(SHEET_LAYOUTS[kind])
  return z.strictObject({ "head-body": layout, "body-only": layout, "head-only": layout, unclear: layout })
}

const sheetsSchema = z.strictObject({
  labeller: llmStepSchema.optional(),
  rules: z.strictObject({ person: rowsOf("person"), pet: rowsOf("pet"), product: rowsOf("product"), location: rowsOf("location") }),
})

const clipBodySchema = z.strictObject({
  mode: z.enum(["on", "off"]),
  prompt: z.string().trim().min(1).max(CLIP_BODY_PROMPT_MAX).optional(),
})

const shotListStyleSchema = z.strictObject({
  mode: z.enum(["on", "off"]),
  llm: llmStepSchema.optional(),
})

const shotListSchema = z.strictObject({
  precise: shotListStyleSchema.optional(),
  flex: shotListStyleSchema.optional(),
})

const stepsShape = z.strictObject({
  sheets: sheetsSchema.optional(),
  enginePrompt: textStepSchema.optional(),
  sceneDescription: textStepSchema.optional(),
  clipBody: clipBodySchema.optional(),
  shotList: shotListSchema.optional(),
})

type Ctx = z.core.$RefinementCtx<z.output<typeof stepsShape>>

function issue(ctx: Ctx, path: (string | number)[], castSwapCode: CastSwapStepsCode, message: string): void {
  ctx.addIssue({ code: "custom", path, message, params: { castSwapCode } })
}

/** Each LLM step of the setting, with its path. */
function llmStepsOf(s: z.output<typeof stepsShape>): Array<{ path: (string | number)[]; llm: LlmStepSetting }> {
  const out: Array<{ path: (string | number)[]; llm: LlmStepSetting }> = []
  if (s.sheets?.labeller) out.push({ path: ["sheets", "labeller"], llm: s.sheets.labeller })
  if (s.enginePrompt?.mode === "llm") out.push({ path: ["enginePrompt", "llm"], llm: s.enginePrompt.llm })
  if (s.sceneDescription?.mode === "llm") out.push({ path: ["sceneDescription", "llm"], llm: s.sceneDescription.llm })
  for (const style of SHOT_LIST_STYLES) {
    const llm = s.shotList?.[style]?.llm
    if (llm) out.push({ path: ["shotList", style, "llm"], llm })
  }
  return out
}

/** The rules every reading checks (stored and saved alike). */
function stepRules(s: z.output<typeof stepsShape>, ctx: Ctx): void {
  for (const { path, llm } of llmStepsOf(s)) {
    if (new Set(llm.inputs).size !== llm.inputs.length) {
      issue(ctx, [...path, "inputs"], "duplicate_input", "An input is listed twice.")
    }
  }
  const labeller = s.sheets?.labeller
  if (labeller && !(labeller.inputs.length === 1 && labeller.inputs[0] === "rolePhotos")) {
    issue(ctx, ["sheets", "labeller", "inputs"], "labeller_inputs", "The photo labeller reads the role's photos only.")
  }
  if (s.sceneDescription?.mode === "llm" && !s.sceneDescription.llm.inputs.includes("clip")) {
    issue(ctx, ["sceneDescription", "llm", "inputs"], "scene_needs_clip", "The scene description must be shown the clip.")
  }
  for (const style of SHOT_LIST_STYLES) {
    const llm = s.shotList?.[style]?.llm
    if (llm && !llm.inputs.includes("clip")) {
      issue(ctx, ["shotList", style, "llm", "inputs"], "scene_needs_clip", "The shot list describes the clip: it must be shown the clip.")
    }
  }
  if (s.shotList?.flex?.mode === "off") {
    issue(ctx, ["shotList", "flex", "mode"], "shot_list_flex_always_on", "Flex always makes its shot list: it cannot be turned off.")
  }
}

/** Whether `model` reads the clip: a model that takes video, or one that reads it as a picture (`CLIP_AS_IMAGE_MODELS`). */
export function modelReadsClip(model: string): boolean {
  return getLlmModalityCaps(model).video || (CLIP_AS_IMAGE_MODELS as readonly string[]).includes(model)
}

/** The save-time rules: a known model that can see what it is shown; an image prompt naming only the engine's placeholders. */
function saveRules(s: z.output<typeof stepsShape>, ctx: Ctx): void {
  const unknown = unknownClipBodyPlaceholders(s.clipBody?.prompt ?? "")
  if (unknown.length > 0) {
    const list = unknown.map((n) => `{${n}}`).join(", ")
    issue(ctx, ["clipBody", "prompt"], "clip_body_placeholder", `Unknown placeholder ${list}: the image prompt may name {subject}, {body} and {hair} only.`)
  }
  for (const { path, llm } of llmStepsOf(s)) {
    if (!(LLM_MODEL_IDS as readonly string[]).includes(llm.model)) {
      issue(ctx, [...path, "model"], "unknown_model", `Unknown model: ${llm.model}.`)
      continue
    }
    if (llm.inputs.some((i) => PICTURE_INPUTS.includes(i)) && !getLlmModalityCaps(llm.model).image) {
      issue(ctx, [...path, "model"], "model_cannot_see_images", "This model cannot see pictures: choose one that can, or show it text only.")
    }
    if (llm.inputs.includes("clip") && !modelReadsClip(llm.model)) {
      issue(ctx, [...path, "model"], "model_cannot_read_clip", "This model cannot read the clip: choose one that takes video, or leave the clip out.")
    }
  }
}

/** The stored setting (a trend version's, the per-engine row's): any model name. */
export const castSwapStepsSchema: z.ZodType<CastSwapSteps> = stepsShape.superRefine(stepRules) as unknown as z.ZodType<CastSwapSteps>

/** What an admin saves: the stored rules, plus a known model that can see what it is shown. */
export const castSwapStepsSaveSchema: z.ZodType<CastSwapSteps> = stepsShape.superRefine((s, ctx) => {
  stepRules(s, ctx)
  saveRules(s, ctx)
}) as unknown as z.ZodType<CastSwapSteps>

/** A refusal of the setting, for an admin screen: where, the code, and why. */
export interface CastSwapStepsProblem {
  path: string
  code: string
  message: string
}

/** The issues of a failed parse, each with its `castSwapCode` (else zod's own code). */
export function stepsProblems(error: z.ZodError, prefix = ""): CastSwapStepsProblem[] {
  return error.issues.map((i) => {
    const params = (i as { params?: { castSwapCode?: unknown } }).params
    const code = typeof params?.castSwapCode === "string" ? params.castSwapCode : i.code
    const path = [prefix, ...i.path.map(String)].filter(Boolean).join(".")
    return { path, code, message: i.message }
  })
}

// ---- Set or not ------------------------------------------------------------

/**
 * Whether anything is set: `{}` (or absent) is today's run exactly, so it is
 * never stored, sent, or counted as a need.
 */
export function stepsSet(s: CastSwapSteps | undefined | null): s is CastSwapSteps {
  return (
    !!s &&
    (s.sheets !== undefined || s.enginePrompt !== undefined || s.sceneDescription !== undefined || s.clipBody !== undefined || shotListSet(s.shotList))
  )
}

/** The setting as stored and sent: `undefined` when nothing is set, else a copy without its absent keys. */
export function normaliseSteps(s: CastSwapSteps | undefined | null): CastSwapSteps | undefined {
  if (!stepsSet(s)) return undefined
  return structuredClone({
    ...(s.sheets !== undefined ? { sheets: s.sheets } : {}),
    ...(s.enginePrompt !== undefined ? { enginePrompt: s.enginePrompt } : {}),
    ...(s.sceneDescription !== undefined ? { sceneDescription: s.sceneDescription } : {}),
    ...(s.clipBody !== undefined ? { clipBody: s.clipBody } : {}),
    ...(shotListSet(s.shotList) ? { shotList: normaliseShotList(s.shotList) } : {}),
  })
}

/** Whether the shot list sets either style (`{}` is nothing set). */
function shotListSet(s: ShotListSetting | undefined): s is ShotListSetting {
  return !!s && (s.precise !== undefined || s.flex !== undefined)
}

/** The shot list without its absent styles. */
function normaliseShotList(s: ShotListSetting): ShotListSetting {
  return {
    ...(s.precise !== undefined ? { precise: s.precise } : {}),
    ...(s.flex !== undefined ? { flex: s.flex } : {}),
  }
}

// ---- Capability gating -----------------------------------------------------

/**
 * Whether a (loaded or recorded) Cast Swap engine takes `steps`
 * (`castSwap.steps`). Absent ⇒ an engine from before them, whose body schema
 * strips the key: it is never sent one.
 */
export function engineTakesSteps(cs: { readonly steps?: boolean } | undefined): boolean {
  return cs?.steps === true
}

/** Whether this process's Cast Swap engine takes `steps`. */
export function loadedEngineTakesSteps(): boolean {
  return engineTakesSteps(getPluginSupports().castSwap)
}

/**
 * Whether a (loaded or recorded) Cast Swap engine takes `steps.clipBody`
 * ("Body from the clip"): it takes steps AND declares
 * `castSwap.clipBodySheet`. An engine with steps but without it is never sent
 * the field (it would refuse or drop it).
 */
export function engineTakesClipBodySheet(cs: { readonly steps?: boolean; readonly clipBodySheet?: boolean } | undefined): boolean {
  return engineTakesSteps(cs) && cs?.clipBodySheet === true
}

/** Whether this process's Cast Swap engine takes `steps.clipBody`. */
export function loadedEngineTakesClipBodySheet(): boolean {
  return engineTakesClipBodySheet(getPluginSupports().castSwap)
}

/**
 * Whether a (loaded or recorded) Cast Swap engine takes `steps.shotList` (the
 * shot list per style): it takes steps AND declares `castSwap.shotList`. An
 * engine without it is never sent the field (its strict schema refuses it).
 */
export function engineTakesShotList(cs: { readonly steps?: boolean; readonly shotList?: boolean } | undefined): boolean {
  return engineTakesSteps(cs) && cs?.shotList === true
}

/** Whether this process's Cast Swap engine takes `steps.shotList`. */
export function loadedEngineTakesShotList(): boolean {
  return engineTakesShotList(getPluginSupports().castSwap)
}

/**
 * Whether the shot list as set needs an engine that declares
 * `castSwap.shotList` to mean what the admin set: Precise turned on, or an
 * LLM of its own on either style. The defaults (Precise off, Flex on, no LLM)
 * mean the same on every engine: one without the step has it stripped and
 * makes no Precise shot list.
 */
export function shotListNeedsEngine(s: ShotListSetting | undefined): boolean {
  if (!s) return false
  return s.precise?.mode === "on" || s.precise?.llm !== undefined || s.flex?.llm !== undefined || (s.flex !== undefined && s.flex.mode !== "on")
}

/**
 * Whether "Body from the clip" as set needs an engine that declares
 * `castSwap.clipBodySheet` to mean what the admin set: only On with an image
 * prompt of its own. Off (and On with no prompt, the default) means the same
 * on every engine: one without the step has it stripped and does not run it.
 */
export function clipBodyNeedsEngine(c: ClipBodySetting | undefined): boolean {
  return c?.mode === "on" && c.prompt !== undefined
}

/**
 * The part of a setting that needs an engine that takes steps: everything
 * set, less a `clipBody` that does not need one (`clipBodyNeedsEngine`).
 * `undefined` when nothing is left. What the save and publish gates test.
 */
export function stepsThatNeedTheEngine(s: CastSwapSteps | undefined | null): CastSwapSteps | undefined {
  const normalised = normaliseSteps(s)
  if (normalised && !clipBodyNeedsEngine(normalised.clipBody)) delete normalised.clipBody
  if (normalised && !shotListNeedsEngine(normalised.shotList)) delete normalised.shotList
  return normaliseSteps(normalised)
}

/**
 * The setting as sent to an engine with these capabilities (`cs`):
 * `undefined` when the engine takes no steps or nothing is left set, else a
 * copy without its absent keys, without `clipBody` unless the engine
 * declares `castSwap.clipBodySheet`, and without `shotList` unless it
 * declares `castSwap.shotList`.
 */
export function stepsForEngine(
  s: CastSwapSteps | undefined | null,
  cs: { readonly steps?: boolean; readonly clipBodySheet?: boolean; readonly shotList?: boolean } | undefined,
): CastSwapSteps | undefined {
  if (!engineTakesSteps(cs)) return undefined
  const normalised = normaliseSteps(s)
  if (normalised && !engineTakesClipBodySheet(cs)) delete normalised.clipBody
  if (normalised && !engineTakesShotList(cs)) delete normalised.shotList
  return normaliseSteps(normalised)
}

/**
 * The body with `steps` only when something is set that the engine (`cs`)
 * takes (`stepsForEngine`); else no `steps` key at all, exactly the body
 * before steps existed. A new object.
 */
export function withStepsFor<T extends { steps?: CastSwapSteps }>(
  body: T,
  cs: { readonly steps?: boolean; readonly clipBodySheet?: boolean; readonly shotList?: boolean } | undefined,
): T {
  const { steps, ...rest } = body
  const sent = stepsForEngine(steps, cs)
  return (sent ? { ...rest, steps: sent } : rest) as T
}

/**
 * A stable hash (sha256 hex) of a scene description step (`TrendFaceMask.sceneStepKey`):
 * the stored text's maker records it, so the panel can say a text was made
 * with another scene setting. `undefined` when the step is unset.
 */
export function sceneStepKeyOf(step: TextStepSetting | undefined): string | undefined {
  if (!step) return undefined
  return createHash("sha256").update(canonicalJson(step)).digest("hex")
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v)
}
