/**
 * One Cast Swap run's preparation steps, for the admin (the trend test run's
 * "Steps" dialog and the admin Jobs page):
 *
 *   GET /v1/admin/jobs/:jobId/cast-swap-steps
 *
 * Replies `{ data: { stepOutputs, sceneText, skippedSteps, styleOnly } }`:
 * - `stepOutputs`: what a run with `steps` recorded of each step (the labels,
 *   the condition, the layout and sheet per role; the engine prompt's mode and
 *   the LLM-written body; the scene step's mode, whether it made the shot
 *   list and the cut times it was told; "Body from the clip"'s frame,
 *   redrawn sheet and image prompt per role; "Style the role pictures"'s
 *   styled picture and what each role sent, and the roles it skipped; a
 *   style-only run's path and whether its video was made gray), from the server-only
 *   `output_data.__castSwapStepOutputs`. null when the run recorded none (a
 *   run with no `steps`: today's steps), or the record is of another version.
 * - `sceneText`: the scene description the run used (`__castSwapSceneText`).
 * - `skippedSteps`: the steps the run went on without (`output_data.skippedSteps`).
 * - `styleOnly`: a style-only run's path ("original" or "flex"): its record's, else
 *   its input's `__styleOnly` (a Full Quality version records no steps of its own);
 *   null for any other run.
 * - `preciseStyleRouted`: true when it resolved to Precise with an art style (the
 *   request, or the admin's forced Style) and the Precise art-style route ran it as Flex (its input's
 *   `__preciseStyleRouted`, a Full Quality version's included); absent otherwise.
 * - `preciseStyleSentGray`: true when the Precise art-style route kept it Precise
 *   and sent its clip in black and white (its art style's route "precise-gray"; its
 *   input's `__preciseStyleSentGray`, a Full Quality version's included); absent otherwise.
 *
 * The `__` keys are server-only: every normal job read strips them
 * (`withoutServerOnlyKeys`, lib/job-output-visibility.ts), so this route reads
 * the row raw with the service role. Admins only; nothing here is reachable by
 * a user. A job that is not a Cast Swap run (a Nodaro Motion or trend run, or
 * a Full Quality version of one) is a 404, as a missing one is.
 *
 * Everything is read tolerantly: the record is the engine's, so a value
 * outside the vocabulary (`cast-swap-steps.ts`) is left out rather than
 * passed on or refused, and a malformed role entry is dropped.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import {
  SHEET_CONDITIONS,
  SHEET_KINDS,
  SHEET_LAYOUTS,
  SKIP_REASONS,
  SKIPPABLE_STEPS,
  STYLE_ONLY_PATHS,
  STYLE_REFS_SENDS,
  type ClipBodyOutput,
  type PhotoLabel,
  type SkippedStep,
  type StepOutputs,
  type StyleOnlyPath,
  type StyleRefsOutput,
} from "../../lib/cast-swap-steps.js"

/** What the admin reads of one Cast Swap run's steps. */
export interface JobCastSwapSteps {
  stepOutputs: StepOutputs | null
  sceneText: string | null
  skippedSteps: SkippedStep[]
  /** A style-only run's path; null for any other run. */
  styleOnly: StyleOnlyPath | null
  /** It resolved to Precise with an art style, and the Precise art-style route ran it as Flex (`__preciseStyleRouted`). Absent otherwise. */
  preciseStyleRouted?: true
  /** The Precise art-style route kept it Precise and sent its clip in black and white (`__preciseStyleSentGray`). Absent otherwise. */
  preciseStyleSentGray?: true
}

/** The job types a Cast Swap run carries: a run, and a Full Quality version (its own queue name). */
const CAST_SWAP_JOB_TYPES: ReadonlySet<string> = new Set(["cast-swap", "cast-swap-full-quality"])

const paramsSchema = z.object({ jobId: z.string().uuid() })

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v)

const LABEL_SUBJECTS: readonly PhotoLabel["subject"][] = ["person", "animal", "product", "place", "other"]
const LABEL_FRAMINGS: readonly PhotoLabel["framing"][] = ["head", "body"]
const LABEL_ANGLES: readonly PhotoLabel["angle"][] = ["front", "three-quarter", "side", "back"]
const LABEL_QUALITIES: readonly PhotoLabel["quality"][] = ["ok", "low"]
const STEP_MODES = ["template", "llm"] as const

/** Whether `row` is a Cast Swap run: its queue name, else (an older insert path) its input's type. */
function isCastSwapJob(row: Rec): boolean {
  if (typeof row.job_type === "string" && CAST_SWAP_JOB_TYPES.has(row.job_type)) return true
  return isRec(row.input_data) && row.input_data.type === "cast-swap"
}

function readLabel(v: unknown): PhotoLabel | null {
  if (!isRec(v)) return null
  const { index, subject, framing, angle, quality } = v
  if (!isIndex(index) || !oneOf(LABEL_SUBJECTS, subject) || !oneOf(LABEL_FRAMINGS, framing)) return null
  if (!oneOf(LABEL_ANGLES, angle) || !oneOf(LABEL_QUALITIES, quality)) return null
  return { index, subject, framing, angle, quality }
}

type RoleOutput = StepOutputs["roles"][number]

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== ""

/** A role's "Body from the clip" record: its known fields only; null when it has none. */
function readClipBody(v: unknown): ClipBodyOutput | null {
  if (!isRec(v)) return null
  const out: ClipBodyOutput = {}
  if (nonBlank(v.frameUrl)) out.frameUrl = v.frameUrl
  if (typeof v.frameSec === "number" && Number.isFinite(v.frameSec) && v.frameSec >= 0) out.frameSec = v.frameSec
  if (nonBlank(v.sheetUrl)) out.sheetUrl = v.sheetUrl
  if (nonBlank(v.prompt)) out.prompt = v.prompt
  return Object.keys(out).length > 0 ? out : null
}

/** One role's record; null when it names no role index or no known kind. */
function readRole(v: unknown): RoleOutput | null {
  if (!isRec(v) || !isIndex(v.role) || !oneOf(SHEET_KINDS, v.kind)) return null
  const kind = v.kind
  const out: RoleOutput = { role: v.role, kind }
  if (Array.isArray(v.labels)) out.labels = v.labels.map(readLabel).filter((l): l is PhotoLabel => l !== null)
  if (oneOf(SHEET_CONDITIONS, v.condition)) out.condition = v.condition
  if (oneOf<string>(SHEET_LAYOUTS[kind], v.layout)) out.layout = v.layout as RoleOutput["layout"]
  if (typeof v.sheetUrl === "string" && v.sheetUrl.trim()) out.sheetUrl = v.sheetUrl
  if (typeof v.kept === "boolean") out.kept = v.kept
  const clipBody = readClipBody(v.clipBody)
  if (clipBody) out.clipBody = clipBody
  return out
}

/** The longest list of cut times kept (a clip is at most minutes long; anything past it is not a record). */
const MAX_CUTS = 1000

/**
 * The scene step's record: its mode, `shotList: true` when the run made its shot list, and `cuts` (the cut
 * times it was told, seconds) only as a list of finite, non-negative numbers — anything else is left out.
 */
function readScene(v: Rec, mode: (typeof STEP_MODES)[number]): NonNullable<StepOutputs["scene"]> {
  const out: NonNullable<StepOutputs["scene"]> = { mode }
  if (v.shotList === true) out.shotList = true
  const cuts = v.cuts
  if (Array.isArray(cuts) && cuts.length <= MAX_CUTS && cuts.every((t) => typeof t === "number" && Number.isFinite(t) && t >= 0)) {
    out.cuts = [...(cuts as number[])]
  }
  return out
}

/**
 * "Style the role pictures"'s record: each role with an index, an http(s) styled picture and a known `sent`;
 * each skipped role with an index and a known reason. Anything else is left out; null when nothing is left.
 */
export function readStyleRefs(v: unknown): StyleRefsOutput | null {
  if (!isRec(v)) return null
  const roles = Array.isArray(v.roles)
    ? v.roles.flatMap((r): StyleRefsOutput["roles"] => {
      if (!isRec(r) || !isIndex(r.role) || !nonBlank(r.styledUrl) || !/^https?:\/\//.test(r.styledUrl) || !oneOf(STYLE_REFS_SENDS, r.sent)) return []
      return [{ role: r.role, styledUrl: r.styledUrl, sent: r.sent }]
    })
    : []
  const skipped = Array.isArray(v.skipped)
    ? v.skipped.flatMap((r): NonNullable<StyleRefsOutput["skipped"]> => {
      if (!isRec(r) || !isIndex(r.role) || !oneOf(SKIP_REASONS, r.reason)) return []
      return [{ role: r.role, reason: r.reason }]
    })
    : []
  if (roles.length === 0 && skipped.length === 0) return null
  return { roles, ...(skipped.length > 0 ? { skipped } : {}) }
}

/** A style-only run's record: a known path, and `grayscale` only as `true`; null without a known path. */
export function readStyleOnly(v: unknown): NonNullable<StepOutputs["styleOnly"]> | null {
  if (!isRec(v) || !oneOf(STYLE_ONLY_PATHS, v.path)) return null
  return { path: v.path, ...(v.grayscale === true ? { grayscale: true as const } : {}) }
}

/**
 * The step outputs record; null unless it is version 1 with a roles list (a record that carries only
 * "Style the role pictures" may leave the roles out: read as none).
 */
export function readStepOutputs(v: unknown): StepOutputs | null {
  if (!isRec(v) || v.v !== 1) return null
  if (!Array.isArray(v.roles) && !(v.roles === undefined && isRec(v.styleRefs))) return null
  const roles: unknown[] = Array.isArray(v.roles) ? v.roles : []
  const out: StepOutputs = { v: 1, roles: roles.map(readRole).filter((r): r is RoleOutput => r !== null) }
  if (isRec(v.enginePrompt) && oneOf(STEP_MODES, v.enginePrompt.mode)) {
    out.enginePrompt = { mode: v.enginePrompt.mode }
    if (typeof v.enginePrompt.text === "string") out.enginePrompt.text = v.enginePrompt.text
  }
  if (isRec(v.scene) && oneOf(STEP_MODES, v.scene.mode)) out.scene = readScene(v.scene, v.scene.mode)
  const styleRefs = readStyleRefs(v.styleRefs)
  if (styleRefs) out.styleRefs = styleRefs
  const styleOnly = readStyleOnly(v.styleOnly)
  if (styleOnly) out.styleOnly = styleOnly
  return out
}

/** The skipped steps of the fixed vocabulary only; `role` kept only as a role index. */
export function readSkippedSteps(v: unknown): SkippedStep[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((s): SkippedStep[] => {
    if (!isRec(s) || !oneOf(SKIPPABLE_STEPS, s.step) || !oneOf(SKIP_REASONS, s.reason)) return []
    return [{ step: s.step, reason: s.reason, ...(isIndex(s.role) ? { role: s.role } : {}) }]
  })
}

export async function adminCastSwapStepsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/jobs/:jobId/cast-swap-steps", { preHandler: requireAdmin }, async (req, reply) => {
    const params = paramsSchema.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: params.error.issues[0]?.message ?? "Invalid job id" },
      })
    }
    const { data, error } = await supabase
      .from("jobs")
      .select("id, job_type, input_data, output_data")
      .eq("id", params.data.jobId)
      .maybeSingle()
    if (error) {
      req.log.error({ err: error }, "admin/jobs cast-swap-steps lookup failed")
      return reply.status(500).send({ error: { code: "internal_error", message: "Lookup failed" } })
    }
    const row = isRec(data) ? data : null
    if (!row || !isCastSwapJob(row)) {
      return reply.status(404).send({ error: { code: "not_found", message: "Cast Swap job not found" } })
    }
    const output = isRec(row.output_data) ? row.output_data : {}
    const input = isRec(row.input_data) ? row.input_data : {}
    const stepOutputs = readStepOutputs(output.__castSwapStepOutputs)
    const out: JobCastSwapSteps = {
      stepOutputs,
      sceneText: typeof output.__castSwapSceneText === "string" ? output.__castSwapSceneText : null,
      skippedSteps: readSkippedSteps(output.skippedSteps),
      styleOnly: stepOutputs?.styleOnly?.path ?? (oneOf(STYLE_ONLY_PATHS, input.__styleOnly) ? input.__styleOnly : null),
      ...(input.__preciseStyleRouted === true ? { preciseStyleRouted: true as const } : {}),
      ...(input.__preciseStyleSentGray === true ? { preciseStyleSentGray: true as const } : {}),
    }
    return reply.send({ data: out })
  })
}
