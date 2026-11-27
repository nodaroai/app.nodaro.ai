import { describe, it, expect } from "vitest"
import { resolveSeedanceTaskType } from "@nodaro/shared/models"
import { seedanceExtend4kSourceProblem, seedanceExtendOfferedResolutions, SEEDANCE_EXTEND_4K_MIN_SHORT_SIDE } from "@nodaro/render-rules"
import { applySeedance2Params } from "../video.js"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS, KIE_CREDIT_USD } from "../models.js"
import { SEEDANCE_25_KIE_CREDITS_PER_SEC, seedance25CostUsd } from "../seedance-cost.js"
import { isLongKieVideoRender, longRenderPollAttempts, SEEDANCE_25_4K_MARGIN, SEEDANCE_25_4K_RENDER_SEC_PER_OUTPUT_SEC } from "../long-render.js"
import { MAX_POLL_ATTEMPTS_VIDEO } from "../client.js"
import { pollDelay } from "../poll-delay.js"
import { providerKindForVideoModel } from "../../../lib/reconcile/provider-kind.js"
import { KIE_RECOVER_KINDS, STALE_THRESHOLD_MS, isAsyncKind } from "../../../lib/reconcile/types.js"

/**
 * Seedance 2.5 at 4K (decided 2026-11-22, offered from 2026-11-25): the
 * provider takes `resolution: "4k"` in every mode, an extension at
 * `aspect_ratio: "adaptive"` only (probed 2026-11-22).
 */
const ID = "seedance-2-5"
const IMG = "https://example.com/a.jpg"
const IMG2 = "https://example.com/b.jpg"
const VID = "https://example.com/v.mp4"
const AUD = "https://example.com/a.mp3"

function body(base: Record<string, unknown>, options: Parameters<typeof applySeedance2Params>[1]) {
  const cfg = base.first_frame_url ? KIE_VIDEO_MODELS[ID]! : KIE_TEXT_TO_VIDEO_MODELS[ID]!
  const input: Record<string, unknown> = { ...cfg.extraParams, prompt: "a cat", ...base }
  applySeedance2Params(input, options, ID)
  return input
}

describe("Seedance 2.5 request bodies at 4K", () => {
  const shapes: Array<[string, Record<string, unknown>, Parameters<typeof applySeedance2Params>[1]]> = [
    ["text", {}, { aspectRatio: "16:9", resolution: "4k" }],
    ["first frame", { first_frame_url: IMG }, { aspectRatio: "16:9", resolution: "4k" }],
    ["first + last frame", { first_frame_url: IMG, last_frame_url: IMG2 }, { aspectRatio: "9:16", resolution: "4k" }],
    ["references", {}, { aspectRatio: "16:9", resolution: "4k", referenceImageUrls: [IMG], referenceVideoUrls: [VID], referenceAudioUrls: [AUD] }],
    ["edit", {}, { aspectRatio: "adaptive", resolution: "4k", referenceVideoUrls: [VID], referenceTaskType: "edit" }],
  ]
  for (const [name, base, options] of shapes) {
    it(`${name}: sends resolution "4k" to the provider`, () => {
      expect(body(base, options).resolution, name).toBe("4k")
    })
  }

  it("a draft still renders 480p, whatever resolution it was sent with", () => {
    expect(body({}, { aspectRatio: "16:9", resolution: "4k", draft: true }).resolution).toBe("480p")
  })
})

describe("Seedance 2.5 Extend at 4K", () => {
  it("an extension is sent at adaptive, whatever ratio was asked (the provider refuses any other)", () => {
    const task = resolveSeedanceTaskType({
      provider: ID,
      requested: "extend",
      referenceImageCount: 0,
      referenceAudioCount: 0,
      referenceVideoSec: [10],
      aspectRatio: "16:9",
      duration: 4,
    })
    expect(task.taskType).toBe("extend")
    expect(task.aspectRatio).toBe("adaptive")
    const input = body({ duration: task.duration }, {
      aspectRatio: task.aspectRatio, resolution: "4k", referenceVideoUrls: [VID], referenceTaskType: task.taskType,
    })
    expect(input.aspect_ratio).toBe("adaptive")
    expect(input.resolution).toBe("4k")
    expect(input.omni_reference_task_type).toBe("extend")
    expect(input.reference_video_urls).toEqual([VID])
  })

  it("is offered only for a source that is already 4K (short side 2160 or more)", () => {
    expect(SEEDANCE_EXTEND_4K_MIN_SHORT_SIDE).toBe(2160)
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4k", { width: 3840, height: 2160 })).toBeUndefined()
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4k", { width: 2160, height: 3840 })).toBeUndefined()
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4k", { width: 1920, height: 1080 })).toMatch(/already 4K.*1920×1080/)
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4k", { width: 3840, height: 2158 })).toBeDefined()
    // "4K" is 4K here exactly as in the run's own resolution rule: refused for a smaller source, run as 4K on a 4K one.
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4K", { width: 1920, height: 1080 })).toBeDefined()
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4K", { width: 3840, height: 2160 })).toBeUndefined()
    // 2160p and UHD are 4K too (decided 2026-11-27): the same rule.
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "2160p", { width: 1920, height: 1080 })).toBeDefined()
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "uhd", { width: 3840, height: 2160 })).toBeUndefined()
    // Flash Extend renders no 4K: a 4K spelling runs at 720p there, nothing to refuse.
    expect(seedanceExtend4kSourceProblem("seedance-2-5-flash-extend", "4k", { width: 1920, height: 1080 })).toBeUndefined()
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "2k", { width: 1920, height: 1080 })).toBeUndefined()
  })

  it("a source of unknown size, any other resolution and any other provider are not refused here", () => {
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4k", undefined)).toBeUndefined()
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "4k", { width: 0, height: 0 })).toBeUndefined()
    expect(seedanceExtend4kSourceProblem("seedance-2-5-extend", "1080p", { width: 1280, height: 720 })).toBeUndefined()
    expect(seedanceExtend4kSourceProblem("gemini-omni-flash-1-2-extend", "4k", { width: 1280, height: 720 })).toBeUndefined()
  })

  it("the editor's menu drops 4K for a known smaller source only", () => {
    expect(seedanceExtendOfferedResolutions("seedance-2-5-extend", { width: 1920, height: 1080 })).toEqual(["480p", "720p", "1080p"])
    expect(seedanceExtendOfferedResolutions("seedance-2-5-extend", { width: 3840, height: 2160 })).toEqual(["480p", "720p", "1080p", "4k"])
    expect(seedanceExtendOfferedResolutions("seedance-2-5-extend", undefined)).toEqual(["480p", "720p", "1080p", "4k"])
  })
})

describe("Seedance 2.5 4K provider cost", () => {
  it("records KIE's 4K rates: 251 a second plain, 155 with a reference video", () => {
    expect(SEEDANCE_25_KIE_CREDITS_PER_SEC["4k"]).toEqual({ plain: 251, ref: 155 })
    // The 4 s probe consumed 251 × 4 KIE credits.
    expect(seedance25CostUsd({ resolution: "4k", draft: false, hasVideoRef: false, outputSec: 4, inputSec: 0 })).toBeCloseTo(1004 * KIE_CREDIT_USD)
    // The extend probe: 4 s sent + 4 s added at the reference rate.
    expect(seedance25CostUsd({ resolution: "4k", draft: false, hasVideoRef: true, outputSec: 4, inputSec: 4 })).toBeCloseTo(1240 * KIE_CREDIT_USD)
  })
})

describe("Seedance 2.5 4K render budget", () => {
  it("a 4K Seedance 2.5 render is long; every other run keeps the standard budget", () => {
    expect(isLongKieVideoRender(ID, "4k")).toBe(true)
    expect(isLongKieVideoRender(ID, "4K")).toBe(true)
    expect(isLongKieVideoRender(ID, "2160p")).toBe(true)
    expect(isLongKieVideoRender(ID, "1080p")).toBe(false)
    expect(isLongKieVideoRender("seedance-2", "4k")).toBe(false)
    expect(isLongKieVideoRender("seedance-2-5-flash", "4k")).toBe(false)
    expect(longRenderPollAttempts(ID, { resolution: "1080p", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
    expect(longRenderPollAttempts("seedance-2", { resolution: "4k", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
  })

  it("polls a 4K run for twice its measured render rate over its seconds, never less than the default", () => {
    const waitedMs = (attempts: number) => Array.from({ length: attempts }, (_, i) => pollDelay(i + 1)).reduce((a, b) => a + b, 0)
    const thirty = longRenderPollAttempts(ID, { resolution: "4k", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)
    expect(waitedMs(thirty)).toBeGreaterThanOrEqual(30 * SEEDANCE_25_4K_RENDER_SEC_PER_OUTPUT_SEC * SEEDANCE_25_4K_MARGIN * 1000)
    expect(waitedMs(thirty - 1)).toBeLessThan(30 * SEEDANCE_25_4K_RENDER_SEC_PER_OUTPUT_SEC * SEEDANCE_25_4K_MARGIN * 1000)
    // The 4 s probe (222 s) fits inside a 4 s run's budget, which is the default's floor.
    expect(waitedMs(longRenderPollAttempts(ID, { resolution: "4k", duration: 4 }, MAX_POLL_ATTEMPTS_VIDEO))).toBeGreaterThan(222_000)
    expect(longRenderPollAttempts(ID, { resolution: "4k", duration: 4 }, MAX_POLL_ATTEMPTS_VIDEO)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
  })

  // Auto (-1) is what a Seedance 2.5 Auto run and every Video to Video edit sends.
  it("an Auto-length 4K run is sized on the model's longest clip, an edit on its measured source", () => {
    const thirty = longRenderPollAttempts(ID, { resolution: "4k", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)
    expect(longRenderPollAttempts(ID, { resolution: "4k", duration: -1 }, MAX_POLL_ATTEMPTS_VIDEO)).toBeGreaterThanOrEqual(thirty)
    expect(longRenderPollAttempts(ID, { resolution: "4k", duration: 0 }, MAX_POLL_ATTEMPTS_VIDEO)).toBeGreaterThanOrEqual(thirty)
    // Any other Auto run with clips (reference-to-video) may render up to the longest clip: 30 s.
    expect(longRenderPollAttempts(ID, { resolution: "4k", duration: -1 }, MAX_POLL_ATTEMPTS_VIDEO, { referenceVideoSec: [5] })).toBe(thirty)
    // The edit lane (the declared edit, or the edit-mode re-send): the source (and any extra reference clip) measured — sized on the longest.
    const edit = (sec: ReadonlyArray<number | null>) =>
      longRenderPollAttempts(ID, { resolution: "4k", duration: -1, omni_reference_task_type: "edit" }, MAX_POLL_ATTEMPTS_VIDEO, { referenceVideoSec: sec })
    expect(longRenderPollAttempts(ID, { resolution: "4k", duration: -1 }, MAX_POLL_ATTEMPTS_VIDEO, { referenceVideoSec: [20, 12], edit: true })).toBe(edit([20, 12]))
    expect(edit([20, 12])).toBe(longRenderPollAttempts(ID, { resolution: "4k", duration: 20 }, MAX_POLL_ATTEMPTS_VIDEO))
    expect(edit([12.4])).toBe(longRenderPollAttempts(ID, { resolution: "4k", duration: 13 }, MAX_POLL_ATTEMPTS_VIDEO))
    // A clip not measured: the longest clip again.
    expect(edit([12, null])).toBe(longRenderPollAttempts(ID, { resolution: "4k", duration: -1 }, MAX_POLL_ATTEMPTS_VIDEO))
    // No length sent at all: the model's default (8 s).
    expect(longRenderPollAttempts(ID, { resolution: "4k" }, MAX_POLL_ATTEMPTS_VIDEO)).toBe(longRenderPollAttempts(ID, { resolution: "4k", duration: 8 }, MAX_POLL_ATTEMPTS_VIDEO))
  })

  it("is recorded under the long-video kind, whose staleness threshold is above a 30 s run's poll", () => {
    expect(providerKindForVideoModel(ID, { resolution: "4k" })).toBe("kie-long-video")
    expect(providerKindForVideoModel(ID, { resolution: "1080p" })).toBe("kie-standard")
    expect(providerKindForVideoModel(ID)).toBe("kie-standard")
    expect(providerKindForVideoModel("seedance-2", { resolution: "4k" })).toBe("kie-standard")
    expect(KIE_RECOVER_KINDS.has("kie-long-video")).toBe(true)
    expect(isAsyncKind("kie-long-video")).toBe(true)
    const thirtySecondPollMs = 30 * SEEDANCE_25_4K_RENDER_SEC_PER_OUTPUT_SEC * SEEDANCE_25_4K_MARGIN * 1000
    expect(STALE_THRESHOLD_MS["kie-long-video"]).toBeGreaterThan(thirtySecondPollMs)
  })
})

describe("Seedance 2.5 4K spellings in the recorded cost", () => {
  it("records 2160p and UHD at the 4K rate", () => {
    for (const v of ["2160p", "UHD"]) {
      expect(seedance25CostUsd({ resolution: v, draft: false, hasVideoRef: false, outputSec: 4, inputSec: 0 }), v).toBeCloseTo(1004 * KIE_CREDIT_USD)
    }
  })
})
