// @test-watches backend/src/workers/handlers/*.ts backend/src/nodes/*/worker.ts backend/src/workers/inline-reconcile.ts backend/src/lib/reconcile/*.ts backend/src/providers/nodaro/video.ts backend/src/lib/job-finalize.ts
/**
 * LENGTH-RECORDING TOTALITY. A length-following video generation run records
 * the length it really is in ONE place: `finalizeJobWithMedia`
 * (`lib/generated-video-recorded-length.ts`), from the job's own request. So a
 * job of a type in `LENGTH_RECORDING_JOB_TYPES` must complete through that
 * funnel on every path, or the step after it is charged by a length the video
 * is not. This fails when one can complete another way.
 *
 * The paths it covers:
 *  1. the worker: the only handlers registered for those job types are the
 *     image-to-video, text-to-video and voiced handlers, and each (with the LTX
 *     dispatch they call) completes through finalize, never a direct write;
 *  2. the reconcile cron and the stall re-pick's inline reconcile: every
 *     generic recovery (KIE, fal, Replicate) finalizes the row's own job type,
 *     those types are finalize video types none of them refuses, none is an
 *     entity type recovered elsewhere, and the only direct completion write
 *     in the reconcile lanes is Replicate's transcription;
 *  3. the cloud relay: the cloud video provider returns into the worker's own
 *     lane (it persists no task id, so no row of these types is ever recovered
 *     as a relayed cloud job);
 *  4. a held completion: the length is recorded before the completion write,
 *     so the held fields an approve replays already carry it.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { LENGTH_RECORDING_JOB_TYPES } from "../generated-video-recorded-length.js"
import { FINALIZE_JOB_TYPES, NOT_GENERIC_RECOVERABLE, VIDEO_JOB_TYPES } from "../job-finalize.js"
import { unitWorkerFiles } from "../unit-source-files.js"

const SRC = join(__dirname, "..", "..")
const REPO_ROOT = join(SRC, "..", "..")
const read = (path: string): string => readFileSync(join(SRC, path), "utf8")
/** Source without comment lines, so a word in prose is never a call. */
const code = (path: string): string => read(path).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")
/** A completion written without the funnel. */
const DIRECT_COMPLETION = /\bmarkJobCompleted(?:Detailed)?\(|status:\s*"completed"/

/** The body of a top-level function, from its declaration to its closing brace in column 0. */
function topLevelFunction(source: string, declaration: string): string {
  const start = source.indexOf(declaration)
  expect(start, `${declaration} not found`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf("\n}\n", start)
  return source.slice(start, end + 2)
}

/** The handlers the worker runs for each length-recording job type, by name. */
const HANDLER_OF: Readonly<Record<string, string>> = {
  "image-to-video": "handleImageToVideo",
  "text-to-video": "handleTextToVideo",
  "voiced-video": "handleVoicedVideo",
}

describe("a length-recording job type completes only through the recording funnel", () => {
  it("the job types are the three video generation rows", () => {
    expect([...LENGTH_RECORDING_JOB_TYPES].sort()).toEqual(Object.keys(HANDLER_OF).sort())
  })

  it("1. the worker: each type's only handler completes through finalize, never a direct write", () => {
    const handlerFiles = readdirSync(join(SRC, "workers", "handlers")).filter((f) => f.endsWith(".ts"))
    for (const type of LENGTH_RECORDING_JOB_TYPES) {
      const registering = handlerFiles.filter((f) => new RegExp(`^\\s*"${type}":\\s*\\w+`, "m").test(code(`workers/handlers/${f}`)))
      expect(registering, `${type}: registered only by video-ai.ts`).toEqual(["video-ai.ts"])
    }
    // A node unit's worker runs its own folder's job type; none of these is a unit.
    const unitWorkers = unitWorkerFiles(REPO_ROOT)
    expect(unitWorkers.length, "the node units' workers are found").toBeGreaterThan(0)
    for (const worker of unitWorkers) {
      expect(LENGTH_RECORDING_JOB_TYPES.has(basename(dirname(worker))), worker).toBe(false)
      const source = readFileSync(worker, "utf8")
      for (const type of LENGTH_RECORDING_JOB_TYPES) {
        expect(new RegExp(`^\\s*"${type}":\\s*\\w+`, "m").test(source), `${worker} registers ${type}`).toBe(false)
      }
    }
    const videoAi = code("workers/handlers/video-ai.ts")
    const registry = topLevelFunction(videoAi, "export const videoAIHandlers")
    for (const [type, handler] of Object.entries(HANDLER_OF)) {
      expect(registry, type).toMatch(new RegExp(`"${type}":\\s*${handler},`))
      const body = topLevelFunction(videoAi, `const ${handler}: HandlerFn = async function ${handler}(`)
      expect(body, `${handler} finalizes`).toMatch(/\bfinalizeJobWithMedia\(/)
      expect(body, `${handler} writes no completion of its own`).not.toMatch(DIRECT_COMPLETION)
    }
    const ltx = topLevelFunction(videoAi, "async function dispatchLtxIfRequested(")
    expect(ltx).toMatch(/\bfinalizeJobWithMedia\(/)
    expect(ltx).not.toMatch(DIRECT_COMPLETION)
    expect(topLevelFunction(videoAi, `const handleImageToVideo: HandlerFn`)).toMatch(/dispatchLtxIfRequested\(job, ctx, "image-to-video"\)/)
  })

  it("2. the reconcile lanes: every generic recovery finalizes the row's own type, and none refuses these", () => {
    for (const type of LENGTH_RECORDING_JOB_TYPES) {
      expect(FINALIZE_JOB_TYPES.has(type), type).toBe(true)
      expect((VIDEO_JOB_TYPES as readonly string[]).includes(type), type).toBe(true)
      expect(NOT_GENERIC_RECOVERABLE.has(type), type).toBe(false)
    }
    const reconcileFiles = readdirSync(join(SRC, "lib", "reconcile")).filter((f) => f.endsWith(".ts"))
    for (const f of ["kie.ts", "fal.ts", "replicate.ts"]) {
      const source = code(`lib/reconcile/${f}`)
      expect(source, f).toMatch(/finalizeJobWithMedia\(\{[\s\S]*?jobType: row\.job_type,/)
      expect(source, f).toMatch(/isFinalizeJobType\(row\.job_type\)/)
    }
    // The direct completion writes in the reconcile lanes, none of which can
    // complete a video generation row: an execution's own status, a LoRA
    // training (a model, its own job), and a transcription (Replicate's whisper
    // lanes; KIE's Nemotron 3.5 Transcribe, since 2026-11-12).
    const direct = reconcileFiles.filter((f) => DIRECT_COMPLETION.test(code(`lib/reconcile/${f}`)))
    expect(direct.sort()).toEqual(["kie.ts", "replicate.ts", "workflow-executions-cron.ts"])
    // KIE's one direct write is its transcription recovery, reached only for a
    // `transcribe` row (a text result: there is no media to finalize).
    const kie = code("lib/reconcile/kie.ts")
    expect([...kie.matchAll(new RegExp(DIRECT_COMPLETION, "g"))]).toHaveLength(1)
    expect(topLevelFunction(kie, "async function reconcileKieTranscribeJob(")).toMatch(DIRECT_COMPLETION)
    expect(kie).toMatch(/if \(row\.job_type === "transcribe"\) return reconcileKieTranscribeJob\(row, opts\)/)
    const executions = code("lib/reconcile/workflow-executions-cron.ts")
    const executionWrite = executions.search(DIRECT_COMPLETION)
    expect(executions.slice(executionWrite), "an execution's status, never a job's").toMatch(/^[\s\S]{0,800}tryTerminalWrite\(row\.id, updates, "flip to completed"/)
    expect(topLevelFunction(executions, "export async function reconcileWorkflowExecutionsTick(")).toMatch(/const result = await updateExecutionWithRetry\(rowId, updates\)/)
    const replicate = code("lib/reconcile/replicate.ts")
    const writes = [...replicate.matchAll(new RegExp(DIRECT_COMPLETION, "g"))].map((w) => w.index!)
    expect(writes).toHaveLength(2)
    expect(topLevelFunction(replicate, "async function applyTrainingTerminalStatus(")).toMatch(DIRECT_COMPLETION)
    expect(replicate.slice(Math.max(0, writes[1]! - 1500), writes[1])).toMatch(/if \(row\.job_type === "transcribe"\) \{/)
    // The stall re-pick recovers inline through the same three.
    expect(code("workers/inline-reconcile.ts")).not.toMatch(DIRECT_COMPLETION)
  })

  it("3. the cloud relay returns into the worker's lane: its video provider persists no task id", () => {
    expect(code("providers/nodaro/video.ts")).not.toMatch(/\bonTaskCreated\(/)
  })

  it("4. the length is recorded before the completion write (a held completion's approve replays it)", () => {
    const finalize = topLevelFunction(code("lib/job-finalize.ts"), "export async function finalizeJobWithMedia(")
    const recordedAt = finalize.indexOf("recordedVideoLengthSec(")
    expect(recordedAt).toBeGreaterThan(0)
    expect(recordedAt).toBeLessThan(finalize.indexOf("markJobCompletedDetailed("))
  })
})
