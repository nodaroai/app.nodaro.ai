/**
 * The finalize dispatch used to be a compile-time union with a runtime cast at
 * three reconcile sites (`(row.job_type ?? "generate-image") as FinalizeJobType`).
 * That cast is what let `generate-character` reach `finalizeJobWithMedia`, throw
 * "unknown jobType", ride `bumpAttemptsOrExhaust` to 18 attempts and REFUND a
 * job whose provider call had succeeded. The union is now also a Set.
 */
import { describe, it, expect } from "vitest"
import {
  FINALIZE_JOB_TYPES,
  isFinalizeJobType,
  IMAGE_JOB_TYPES,
  VIDEO_JOB_TYPES,
  AUDIO_JOB_TYPES,
  NOT_GENERIC_RECOVERABLE,
} from "../job-finalize.js"

describe("isFinalizeJobType", () => {
  it("accepts the media types finalize can dispatch", () => {
    expect(isFinalizeJobType("generate-image")).toBe(true)
    expect(isFinalizeJobType("text-to-video")).toBe(true)
    expect(isFinalizeJobType("generate-music")).toBe(true)
  })

  it("rejects null, undefined and unknown types instead of defaulting to an image", () => {
    expect(isFinalizeJobType(null)).toBe(false)
    expect(isFinalizeJobType(undefined)).toBe(false)
    expect(isFinalizeJobType("generate-character")).toBe(false)
    expect(isFinalizeJobType("transcribe")).toBe(false)
  })

  it("covers the four handlers that finalize under an alias of their job_type", () => {
    // video-ai.ts:864 finalizes speech-to-video as image-to-video (:891);
    // :1387 finalizes face-swap as video-to-video (:1404); image-ai.ts:372
    // aliases reference-board onto handleGenerateImage (:135); audio-ai.ts:804
    // finalizes text-to-dialogue as generate-dialogue (:405). The reconcile
    // crons read the ROW's job_type, so the alias must be recoverable too.
    expect(isFinalizeJobType("speech-to-video")).toBe(true)
    expect(isFinalizeJobType("face-swap")).toBe(true)
    expect(isFinalizeJobType("reference-board")).toBe(true)
    expect(isFinalizeJobType("text-to-dialogue")).toBe(true)
  })

  it("exposes the set and the predicate over the same members", () => {
    for (const t of FINALIZE_JOB_TYPES) expect(isFinalizeJobType(t)).toBe(true)
  })

  it("keeps the three category arrays pairwise disjoint with no internal duplicates", () => {
    const groups = [IMAGE_JOB_TYPES, VIDEO_JOB_TYPES, AUDIO_JOB_TYPES]
    const seen = new Map<string, string>()
    const groupNames = ["IMAGE_JOB_TYPES", "VIDEO_JOB_TYPES", "AUDIO_JOB_TYPES"]
    groups.forEach((group, i) => {
      for (const t of group) {
        expect(seen.has(t), `"${t}" appears in both ${seen.get(t)} and ${groupNames[i]}`).toBe(false)
        seen.set(t, groupNames[i])
      }
    })
  })

  it("has the three category arrays jointly cover FINALIZE_JOB_TYPES with no overlap", () => {
    const total = IMAGE_JOB_TYPES.length + VIDEO_JOB_TYPES.length + AUDIO_JOB_TYPES.length
    expect(total).toBe(FINALIZE_JOB_TYPES.size)
  })

  it("places each alias in the specific category set the brief specifies", () => {
    expect(IMAGE_JOB_TYPES).toContain("reference-board")
    expect(VIDEO_JOB_TYPES).toContain("speech-to-video")
    expect(VIDEO_JOB_TYPES).toContain("face-swap")
    expect(AUDIO_JOB_TYPES).toContain("text-to-dialogue")
  })
})

describe("NOT_GENERIC_RECOVERABLE", () => {
  it("is disjoint from FINALIZE_JOB_TYPES — the denylist check runs FIRST in every", () => {
    // writer, so a type present in both sets would silently become
    // non-recoverable even though it's a real finalize type.
    for (const t of NOT_GENERIC_RECOVERABLE) {
      expect(FINALIZE_JOB_TYPES.has(t), t).toBe(false)
    }
  })

  // 1 entity (generate-script — the LLM lane, which never calls onTaskCreated
  // and so persists no provider task id to poll) + 10 DAG + 3 composite + 44
  // Task-5 coverage-guard additions (24 ffmpeg + 12 suno + reference-sheet +
  // motion-graphics-lottie + 5 audio-ai stragglers: extract-youtube-audio,
  // audio-separation, forced-alignment, voice-changer, dubbing) = 58.
  //
  // It was 71 until the entity studios stopped being denied: their 13 MEDIA
  // types moved to `ENTITY_MEDIA_JOB_SPECS` (lib/entity-finalize.ts), where
  // the reconciler runs the SAME completion tail the worker runs instead of
  // discarding a finished provider result and refunding the user 90 minutes
  // later. `finalize-job-type-coverage.test.ts` is what keeps the three sets
  // total and pairwise disjoint; this pin is only the ratchet. `video-overlay`
  // (a local ffmpeg lane with no provider task id to poll) took it to 61.
  it("has exactly 61 members", () => {
    expect(NOT_GENERIC_RECOVERABLE.size).toBe(61)
  })

  it("denies generate-script and no other entity handler key", () => {
    expect(NOT_GENERIC_RECOVERABLE.has("generate-script")).toBe(true)
    for (const t of ["generate-character", "generate-object-asset", "generate-character-motion"]) {
      expect(NOT_GENERIC_RECOVERABLE.has(t), t).toBe(false)
    }
  })
})
