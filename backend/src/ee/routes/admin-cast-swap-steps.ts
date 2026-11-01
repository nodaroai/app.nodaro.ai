/**
 * One Cast Swap run's preparation steps, for the admin (the trend test run's
 * "Steps" dialog and the admin Jobs page):
 *
 *   GET /v1/admin/jobs/:jobId/cast-swap-steps
 *
 * Replies `{ data: { stepOutputs, sceneText, skippedSteps } }`:
 * - `stepOutputs`: what a run with `steps` recorded of each step (the labels,
 *   the condition, the layout and sheet per role; the engine prompt's mode and
 *   the LLM-written body; the scene step's mode, whether it made the shot
 *   list and the cut times it was told; "Body from the clip"'s frame,
 *   redrawn sheet and image prompt per role), from the server-only
 *   `output_data.__castSwapStepOutputs`. null when the run recorded none (a
 *   run with no `steps`: today's steps), or the record is of another version.
 * - `sceneText`: the scene description the run used (`__castSwapSceneText`).
 * - `skippedSteps`: the steps the run went on without (`output_data.skippedSteps`).
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
  type ClipBodyOutput,
  type PhotoLabel,
  type SkippedStep,
  type StepOutputs,
} from "../../lib/cast-swap-steps.js"

/** What the admin reads of one Cast Swap run's steps. */
export interface JobCastSwapSteps {
  stepOutputs: StepOutputs | null
  sceneText: string | null
  skippedSteps: SkippedStep[]
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

/** The step outputs record; null unless it is version 1 with a roles list. */
export function readStepOutputs(v: unknown): StepOutputs | null {
  if (!isRec(v) || v.v !== 1 || !Array.isArray(v.roles)) return null
  const out: StepOutputs = { v: 1, roles: v.roles.map(readRole).filter((r): r is RoleOutput => r !== null) }
  if (isRec(v.enginePrompt) && oneOf(STEP_MODES, v.enginePrompt.mode)) {
    out.enginePrompt = { mode: v.enginePrompt.mode }
    if (typeof v.enginePrompt.text === "string") out.enginePrompt.text = v.enginePrompt.text
  }
  if (isRec(v.scene) && oneOf(STEP_MODES, v.scene.mode)) out.scene = readScene(v.scene, v.scene.mode)
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
    const out: JobCastSwapSteps = {
      stepOutputs: readStepOutputs(output.__castSwapStepOutputs),
      sceneText: typeof output.__castSwapSceneText === "string" ? output.__castSwapSceneText : null,
      skippedSteps: readSkippedSteps(output.skippedSteps),
    }
    return reply.send({ data: out })
  })
}
