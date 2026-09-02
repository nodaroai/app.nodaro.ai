/**
 * B2 guard (spec 2026-09-01-app-reports-triage-design.md §7).
 *
 * Every job_type a reconcile tick can read must be EITHER finalizable
 * (FINALIZE_JOB_TYPES) or explicitly not-generically-recoverable
 * (NOT_GENERIC_RECOVERABLE). A type in neither set means the reconcile writer
 * bumps to exhaustion and refunds a job whose provider call may have
 * succeeded — the 2026-08-31 `[job-finalize] generate-character` row.
 *
 * Source 1 (derived): the nine STATICALLY-EXPORTED handler maps.
 * `video-worker.ts:210` stamps `job_type: job.name` at pickup, so every
 * handler key is a producible type. We import the maps directly rather than
 * `allHandlers` — that is a module-local const in video-worker.ts finished by
 * top-level awaits, and importing video-worker.ts boots a BullMQ Worker.
 * Out of reach by construction, and deliberately so: the relay handlers
 * (community-only dynamic import), createSurroundHandlers(engines.surround),
 * and the @nodaroai/cloud-plugins handlers all arrive at runtime.
 * Source 2 (pinned, NOT derivable): DAG-origin types. `node-executor.ts:1290`
 * inserts `job_type: node.type`, but the node-type -> jobName mapping lives
 * only as switch cases inside buildPayload, so there is nothing to import.
 * The length assertion is the ratchet: add a DAG node type, decide its set.
 */
import { describe, it, expect } from "vitest"
import { imageAIHandlers } from "../../../workers/handlers/image-ai.js"
import { videoAIHandlers } from "../../../workers/handlers/video-ai.js"
import { videoSfxHandlers } from "../../../workers/handlers/video-sfx.js"
import { ffmpegHandlers } from "../../../workers/handlers/ffmpeg.js"
import { audioAIHandlers } from "../../../workers/handlers/audio-ai.js"
import { sunoHandlers } from "../../../workers/handlers/suno.js"
import { entityHandlers } from "../../../workers/handlers/entity.js"
import { referenceSheetHandlers } from "../../../workers/handlers/reference-sheet.js"
import { motionGraphicsLottieHandlers } from "../../../workers/handlers/motion-graphics-lottie.js"
import { FINALIZE_JOB_TYPES, NOT_GENERIC_RECOVERABLE } from "../../job-finalize.js"

/** The nine maps video-worker.ts:37-49 spreads statically into `allHandlers`. */
const STATIC_HANDLER_JOB_NAMES: readonly string[] = Object.keys({
  ...imageAIHandlers,
  ...videoAIHandlers,
  ...videoSfxHandlers,
  ...ffmpegHandlers,
  ...audioAIHandlers,
  ...sunoHandlers,
  ...entityHandlers,
  ...referenceSheetHandlers,
  ...motionGraphicsLottieHandlers,
})

/** DAG node types that reach a jobs row with an async provider_kind. Pinned —
 *  see the header. Audit §B4 enumerates the payload-builder dispatch lines. */
const DAG_ORIGIN_JOB_TYPES = [
  "character", "face", "object", "creature", "location", "scene",
  "modify-image", "upscale-image", "remove-background", "motion-graphics",
] as const

function classify(jobType: string): "finalize" | "denied" | "uncovered" {
  if (FINALIZE_JOB_TYPES.has(jobType)) return "finalize"
  if (NOT_GENERIC_RECOVERABLE.has(jobType)) return "denied"
  return "uncovered"
}

describe("finalize job-type coverage", () => {
  it("pins the DAG-origin list so a new node type forces a decision", () => {
    expect(DAG_ORIGIN_JOB_TYPES).toHaveLength(10)
  })

  it("classifies every DAG-origin job_type", () => {
    for (const t of DAG_ORIGIN_JOB_TYPES) {
      expect(`${t}:${classify(t)}`).toBe(`${t}:denied`)
    }
  })

  it("finds the static handler maps (guard against an import going stale)", () => {
    // If a map is renamed or emptied, the "classifies every handler" case
    // below would pass vacuously. Pin a floor instead.
    expect(STATIC_HANDLER_JOB_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(STATIC_HANDLER_JOB_NAMES).toContain("generate-image")
    expect(STATIC_HANDLER_JOB_NAMES).toContain("generate-character")
  })

  it("classifies every statically-registered worker handler name", () => {
    const uncovered = STATIC_HANDLER_JOB_NAMES.filter((t) => classify(t) === "uncovered")
    // A handler whose job can only ever be SYNC (no provider_task_id is ever
    // persisted) is harmless here, but listing it costs one line and makes the
    // decision explicit. Add it to NOT_GENERIC_RECOVERABLE with a comment —
    // UNLESS it finalizes under an alias of its own job_type, in which case it
    // belongs in the finalize sets instead (see text-to-dialogue, M-3a).
    expect(uncovered).toEqual([])
  })

  it("keeps the two sets disjoint", () => {
    const both = [...FINALIZE_JOB_TYPES].filter((t) => NOT_GENERIC_RECOVERABLE.has(t))
    expect(both).toEqual([])
  })

  it("allows a set member with no producer (does not assert the reverse direction)", () => {
    // "speech-to-text" is in AUDIO_TYPES but nothing writes it — routes/
    // transcribe.ts:71 and audio-ai.ts:800 both use "transcribe". Asserting
    // set ⊆ producers would fail on a harmless legacy member.
    expect(FINALIZE_JOB_TYPES.has("speech-to-text")).toBe(true)
    expect(STATIC_HANDLER_JOB_NAMES).not.toContain("speech-to-text")
  })
})
