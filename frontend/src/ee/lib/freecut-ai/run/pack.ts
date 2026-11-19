/**
 * What Edit with AI makes from the video (clips, a trailer, chapters) is
 * planned by the platform's own podcast tools, started together as ONE podcast
 * pack: one price for the recording's length, every tool chosen included
 * (POST /v1/podcast-pack). Each tool runs on the server as its own run; its
 * plan is read as soon as that run has planned (its plan step's output), so
 * the editor cuts the result itself without waiting for the server's renders,
 * which go on and land in the person's library.
 */
import { getWorkflowExecution, podcastPack } from "@/lib/api"
import { unwrapEditPlanOutput } from "@nodaro/shared/edl"
import { CHAPTERS_NODE_IDS, CLIP_PACK_NODE_IDS, TRAILER_NODE_IDS, USE_CASE_NODE_TYPES, usecaseDescriptor, type UseCaseNodeType, type UseCaseResultKind } from "@nodaro/render-rules"
import type { RunContext } from "./context"
import { JobFailed, JobTimedOut, pause, untilStopped, waitForJob } from "./jobs"

/** The pack's rate: per started 15 seconds of the recording (the server's `podcast-pack:per-15s`). */
export const PACK_RATE_ID = "podcast-pack:per-15s"
const PACK_UNIT_SECONDS = 15

/** The units a recording of `seconds` is charged, as the server counts them: every started 15 seconds, at least one. */
export function packUnits(seconds: number): number {
  return Math.max(1, Math.ceil(Math.round(seconds * 1000) / (PACK_UNIT_SECONDS * 1000)))
}

export type PackMade = "clips" | "trailer" | "chapters"

/** What each made thing is, in the use-case tools' own terms: the tool that makes the same result. */
const MADE_RESULT = { clips: "clips", trailer: "formats", chapters: "chapters" } as const satisfies Record<PackMade, UseCaseResultKind>

/** The platform tool that plans a made thing: the use-case tool whose result it is. */
function packTool(made: PackMade): UseCaseNodeType {
  const type = USE_CASE_NODE_TYPES.find((t) => usecaseDescriptor(t).resultKind === MADE_RESULT[made])
  if (!type) throw new Error(`no use-case tool makes ${MADE_RESULT[made]}`)
  return type
}

/** The step of each tool's run that holds its plan. */
const PLAN_NODE: Readonly<Record<PackMade, string>> = { clips: CLIP_PACK_NODE_IDS.plan, trailer: TRAILER_NODE_IDS.plan, chapters: CHAPTERS_NODE_IDS.plan }

/**
 * A plan as the editor reads it. A plan step can answer the clips as a bare
 * list, which is already the form the clips are read in; any other plan is
 * unwrapped as a job's output is.
 */
function planFrom(json: unknown): unknown {
  return Array.isArray(json) ? json : unwrapEditPlanOutput(json)
}

const PLAN_TIMEOUT_MS = 15 * 60_000
const POLL_MS = 2500
const ENDED = new Set(["failed", "cancelled", "timed_out", "discarded"])

export interface PackAsk {
  readonly clips?: { readonly count: number }
  readonly trailer?: boolean
  readonly chapters?: boolean
}

interface ToolRun {
  readonly tool: string
  readonly jobId: string
  readonly executionId: string | null
}

/** The body's tools: each with its own settings, the rest at the tool's defaults. */
function packTools(ask: PackAsk): Record<string, Record<string, unknown>> {
  return {
    ...(ask.clips ? { [packTool("clips")]: { count: ask.clips.count } } : {}),
    ...(ask.trailer ? { [packTool("trailer")]: {} } : {}),
    ...(ask.chapters ? { [packTool("chapters")]: {} } : {}),
  }
}

interface NodeStateLike {
  readonly status?: string
  readonly output?: { readonly json?: unknown }
  readonly error?: string
}

/** A tool's plan, read from its run as soon as the plan step is done; its job's own output when the run cannot be read. */
async function planOf(ctx: RunContext, run: ToolRun, made: PackMade): Promise<unknown> {
  const end = Date.now() + PLAN_TIMEOUT_MS
  if (run.executionId) {
    for (;;) {
      try {
        const execution = await getWorkflowExecution(run.executionId)
        const state = execution.nodeStates?.[PLAN_NODE[made]] as NodeStateLike | undefined
        if (state?.status === "completed" && state.output?.json !== undefined) return planFrom(state.output.json)
        if (state?.status === "failed") throw new JobFailed(state.error ?? "failed")
        if (ENDED.has(execution.status)) throw new JobFailed(execution.status)
        if (execution.status === "completed") break
      } catch (error) {
        if (error instanceof JobFailed) throw error
        const status = (error as { status?: unknown } | null)?.status
        // A run this person cannot read: its job still tells the outcome.
        if (status === 403 || status === 404) break
      }
      if (Date.now() > end) throw new JobTimedOut()
      await pause(POLL_MS, ctx.signal)
    }
  }
  const output = await waitForJob(run.jobId, ctx.signal, Math.max(60_000, end - Date.now()))
  return planFrom(output.plan ?? output.json)
}

/**
 * Starts one pack for what is asked and answers each made thing's plan, read
 * when its turn comes. A tool the pack could not start fails only its own step.
 */
export function startPack(ctx: RunContext, videoUrl: string, ask: PackAsk): Partial<Record<PackMade, Promise<unknown>>> {
  const tools = packTools(ask)
  if (Object.keys(tools).length === 0) return {}
  const started = untilStopped(podcastPack({ mediaUrls: [videoUrl], tools }), ctx.signal)
  const plans: Partial<Record<PackMade, Promise<unknown>>> = {}
  for (const made of ["clips", "trailer", "chapters"] as const) {
    if (!(packTool(made) in tools)) continue
    plans[made] = started.then((answer) => {
      const run = answer.tools?.find((r) => r.tool === packTool(made))
      if (!run) {
        const refused = answer.notStarted?.find((n) => n.tool === packTool(made))
        throw new JobFailed(refused?.error.message ?? "not started")
      }
      return planOf(ctx, run, made)
    })
  }
  return plans
}
