/**
 * B2 guard (spec 2026-09-01-app-reports-triage-design.md §7).
 *
 * Every job_type a reconcile tick can read must fall in EXACTLY ONE of three
 * buckets: generically finalizable (FINALIZE_JOB_TYPES), recovered through the
 * shared entity tail (ENTITY_MEDIA_JOB_SPECS — the studio lanes, whose own
 * completion writer the reconciler now runs), or explicitly
 * not-generically-recoverable (NOT_GENERIC_RECOVERABLE). A type in none of
 * them means the reconcile writer bumps to exhaustion and refunds a job whose
 * provider call may have succeeded — the 2026-08-31 `[job-finalize]
 * generate-character` row, and the 2026-09-03/09-07 bursts that followed it.
 *
 * Source 1 (derived): the ten STATICALLY-EXPORTED handler maps.
 * The pickup CAS in `video-worker.ts` OVERWRITES `job_type` with `job.name`
 * (unconditionally — not a backfill; see that comment for the gallery
 * dependency), so every handler key is a producible type. We import the maps directly rather than
 * `allHandlers` — that is a module-local const in video-worker.ts finished by
 * top-level awaits, and importing video-worker.ts boots a BullMQ Worker.
 * Out of reach by construction, and deliberately so: the relay handlers
 * (community-only dynamic import), createSurroundHandlers(engines.surround),
 * and the @nodaroai/cloud-plugins handlers all arrive at runtime.
 * Source 2 (pinned, NOT derivable): DAG-origin types. `node-executor.ts`
 * INSERTS `job_type: node.type` (and the pickup overwrite above then replaces
 * it, so these values are only ever read pre-pickup), but the node-type ->
 * jobName mapping lives only as switch cases inside buildPayload, so there is
 * nothing to import.
 * The length assertion is the ratchet: add a DAG node type, decide its set.
 */
import { describe, it, expect } from "vitest"
import { imageAIHandlers } from "../../../workers/handlers/image-ai.js"
import { videoAIHandlers } from "../../../workers/handlers/video-ai.js"
import { videoSfxHandlers } from "../../../workers/handlers/video-sfx.js"
import { videoDepthHandlers } from "../../../workers/handlers/video-depth.js"
import { ffmpegHandlers } from "../../../workers/handlers/ffmpeg.js"
import { audioAIHandlers } from "../../../workers/handlers/audio-ai.js"
import { sunoHandlers } from "../../../workers/handlers/suno.js"
import { entityHandlers } from "../../../workers/handlers/entity.js"
import { referenceSheetHandlers } from "../../../workers/handlers/reference-sheet.js"
import { motionGraphicsLottieHandlers } from "../../../workers/handlers/motion-graphics-lottie.js"
import { FINALIZE_JOB_TYPES, NOT_GENERIC_RECOVERABLE } from "../../job-finalize.js"
import { ENTITY_MEDIA_JOB_SPECS } from "../../entity-finalize.js"

/** The ten maps video-worker.ts spreads statically into `allHandlers`. */
const STATIC_HANDLER_JOB_NAMES: readonly string[] = Object.keys({
  ...imageAIHandlers,
  ...videoAIHandlers,
  ...videoSfxHandlers,
  ...videoDepthHandlers,
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

function classify(jobType: string): "finalize" | "entity" | "denied" | "uncovered" {
  if (FINALIZE_JOB_TYPES.has(jobType)) return "finalize"
  if (ENTITY_MEDIA_JOB_SPECS.has(jobType)) return "entity"
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

  it("keeps the three sets pairwise disjoint", () => {
    // Two classifications for one type is an ambiguity, not a belt-and-braces:
    // the reconcile writers consult them in order, so the loser silently never
    // runs and nobody finds out until a job is refunded.
    expect([...FINALIZE_JOB_TYPES].filter((t) => NOT_GENERIC_RECOVERABLE.has(t))).toEqual([])
    expect([...FINALIZE_JOB_TYPES].filter((t) => ENTITY_MEDIA_JOB_SPECS.has(t))).toEqual([])
    expect([...ENTITY_MEDIA_JOB_SPECS.keys()].filter((t) => NOT_GENERIC_RECOVERABLE.has(t))).toEqual([])
  })

  it("classifies every entity handler as recoverable, except the text one", () => {
    // The whole point of the 2026-09-15 fix: an entity job whose worker died
    // mid-flight is completed from the recovered provider result, not refunded
    // 90 minutes later. `generate-script` is the only entity key that stays
    // denied — it is the LLM lane and persists no provider task id to poll.
    const entityKeys = STATIC_HANDLER_JOB_NAMES.filter((t) => t.startsWith("generate-") &&
      (ENTITY_MEDIA_JOB_SPECS.has(t) || t === "generate-script"))
    expect(entityKeys).toHaveLength(14)
    expect(classify("generate-script")).toBe("denied")
    for (const t of ENTITY_MEDIA_JOB_SPECS.keys()) {
      expect(`${t}:${classify(t)}`).toBe(`${t}:entity`)
    }
  })

  it("gives every entity media type a media kind, and every motion lane a column", () => {
    // `defaultColumn` is THE definition of the motion attach columns (they used
    // to be literals in the routes' queue payloads, invisible to the persisted
    // row). A motion lane without one recovers into no attach at all.
    for (const [t, spec] of ENTITY_MEDIA_JOB_SPECS) {
      expect(`${t}:${spec.media}`).toMatch(/:(image|video)$/)
      if (t.endsWith("-motion")) expect(`${t}:${spec.defaultColumn ?? "MISSING"}`).not.toContain("MISSING")
      expect(spec.includeAssetType).toBe(t.endsWith("-asset"))
    }
  })

  it("allows a set member with no producer (does not assert the reverse direction)", () => {
    // "speech-to-text" is in AUDIO_TYPES but nothing writes it — routes/
    // transcribe.ts:71 and audio-ai.ts:800 both use "transcribe". Asserting
    // set ⊆ producers would fail on a harmless legacy member.
    expect(FINALIZE_JOB_TYPES.has("speech-to-text")).toBe(true)
    expect(STATIC_HANDLER_JOB_NAMES).not.toContain("speech-to-text")
  })
})
