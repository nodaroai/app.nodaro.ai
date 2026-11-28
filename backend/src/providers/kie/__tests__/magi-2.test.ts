import { describe, it, expect } from "vitest"
import { isLongKieVideoRender, longRenderPollAttempts, MAGI_2_MARGIN, MAGI_2_RENDER_SEC_PER_OUTPUT_SEC } from "../long-render.js"
import { MAX_POLL_ATTEMPTS_VIDEO, pollDelay } from "../poll-delay.js"
import { providerKindForVideoModel } from "../../../lib/reconcile/provider-kind.js"
import { STALE_THRESHOLD_MS } from "../../../lib/reconcile/types.js"
import { getModel } from "@nodaro/shared/model-catalog"
import { videoProviderFoldsLoneEndFrame, VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared/models"
import {
  buildMagi2Request,
  magi2CostUsd,
  magi2Seed,
  magi2FrameAspect,
  magi2NamesShape,
  resolveMagi2Aspect,
  MAGI_2_DEFAULT_PROMPT,
  MAGI_2_IMAGE_TO_VIDEO_FIELDS,
  MAGI_2_PROMPT_MAX,
  MAGI_2_REFERENCE_TO_VIDEO_FIELDS,
  MAGI_2_TEXT_TO_VIDEO_FIELDS,
} from "../magi-2.js"
import {
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_MODELS,
  MAGI_2_IMAGE_TO_VIDEO_MODEL,
  MAGI_2_REFERENCE_TO_VIDEO_MODEL,
  MAGI_2_TEXT_TO_VIDEO_MODEL,
} from "../models.js"

const img = (n: number) => `https://cdn.example/ref-${n}.png`

function keysWithin(input: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) expect(allowed, key).toContain(key)
}

describe("MAGI-2 request bodies (magi-2.ts)", () => {
  it("nothing wired runs text-to-video with the allow-listed body", () => {
    const { model, input } = buildMagi2Request({ prompt: "a fox in snow", durationSec: 5 })
    expect(model).toBe(MAGI_2_TEXT_TO_VIDEO_MODEL)
    expect(input).toEqual({ prompt: "a fox in snow", duration: 5, resolution: "1080p", generate_audio: true, aspect_ratio: "16:9" })
    keysWithin(input, MAGI_2_TEXT_TO_VIDEO_FIELDS)
  })

  it("a first frame (and a last frame) runs image-to-video with no aspect ratio", () => {
    const { model, input } = buildMagi2Request({ prompt: "walks", durationSec: 8, aspectRatio: "9:16", startFrameUrl: img(1), endFrameUrl: img(2) })
    expect(model).toBe(MAGI_2_IMAGE_TO_VIDEO_MODEL)
    expect(input).toEqual({ first_frame_url: img(1), last_frame_url: img(2), prompt: "walks", duration: 8, resolution: "1080p", generate_audio: true })
    keysWithin(input, MAGI_2_IMAGE_TO_VIDEO_FIELDS)
  })

  it("any reference runs reference-to-video, the frames joining the images after the caller's own", () => {
    const { model, input } = buildMagi2Request({
      prompt: "the woman in @image_1 speaks",
      durationSec: 10,
      aspectRatio: "21:9",
      startFrameUrl: img(9),
      referenceImageUrls: [img(1)],
      referenceVideoUrls: ["https://cdn.example/v.mp4"],
      referenceAudioUrls: ["https://cdn.example/a.wav"],
    })
    expect(model).toBe(MAGI_2_REFERENCE_TO_VIDEO_MODEL)
    expect(input.reference_image_urls).toEqual([img(1), img(9)])
    expect(input.reference_video_urls).toEqual(["https://cdn.example/v.mp4"])
    expect(input.reference_audio_urls).toEqual(["https://cdn.example/a.wav"])
    expect(input.aspect_ratio).toBe("21:9")
    expect(String(input.prompt)).toMatch(/^the woman in @image_1 speaks\n\n/)
    expect(input).not.toHaveProperty("first_frame_url")
    keysWithin(input, MAGI_2_REFERENCE_TO_VIDEO_FIELDS)
  })

  it("a prompt with only reference audio is a reference run with no image list", () => {
    const { model, input } = buildMagi2Request({ prompt: "a song", durationSec: 6, referenceAudioUrls: ["https://cdn.example/a.mp3"] })
    expect(model).toBe(MAGI_2_REFERENCE_TO_VIDEO_MODEL)
    expect(input).not.toHaveProperty("reference_image_urls")
    expect(input.reference_audio_urls).toEqual(["https://cdn.example/a.mp3"])
  })

  it("a lone last frame becomes the one reference image (the fold the route applies)", () => {
    expect(videoProviderFoldsLoneEndFrame("magi-2")).toBe(true)
    const { model, input } = buildMagi2Request({ prompt: "ends here", durationSec: 5, endFrameUrl: img(3) })
    expect(model).toBe(MAGI_2_REFERENCE_TO_VIDEO_MODEL)
    expect(input.reference_image_urls).toEqual([img(3)])
  })

  it("holds the references to 10 / 5 / 5, frames counted among the images", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["magi-2"]).toMatchObject({ images: 10, videos: 5, audio: 5, requestRefusesOverLimit: true })
    const { input, droppedRefImages } = buildMagi2Request({
      prompt: "p",
      durationSec: 5,
      startFrameUrl: img(99),
      referenceImageUrls: Array.from({ length: 12 }, (_, i) => img(i)),
      referenceVideoUrls: Array.from({ length: 7 }, (_, i) => `https://cdn.example/v${i}.mp4`),
      referenceAudioUrls: Array.from({ length: 7 }, (_, i) => `https://cdn.example/a${i}.mp3`),
    })
    expect((input.reference_image_urls as string[]).length).toBe(10)
    expect((input.reference_image_urls as string[]).at(-1)).toBe(img(99))
    expect(droppedRefImages).toBe(3)
    expect((input.reference_video_urls as string[]).length).toBe(5)
    expect((input.reference_audio_urls as string[]).length).toBe(5)
  })

  it("sound is on unless turned off, and a seed is sent only inside 0-2147483647", () => {
    expect(buildMagi2Request({ prompt: "p", durationSec: 5, sound: false }).input.generate_audio).toBe(false)
    expect(buildMagi2Request({ prompt: "p", durationSec: 5, generateAudio: false }).input.generate_audio).toBe(false)
    expect(buildMagi2Request({ prompt: "p", durationSec: 5, seed: 42 }).input.seed).toBe(42)
    expect(buildMagi2Request({ prompt: "p", durationSec: 5, seed: -1 }).input).not.toHaveProperty("seed")
    expect(magi2Seed(2147483648)).toBeUndefined()
    expect(magi2Seed(1.5)).toBeUndefined()
  })

  it("an empty prompt is sent as the default text, and a reference run's prompt stays inside the cap", () => {
    expect(buildMagi2Request({ prompt: "  ", durationSec: 5 }).input.prompt).toBe(MAGI_2_DEFAULT_PROMPT)
    const long = "x".repeat(MAGI_2_PROMPT_MAX)
    const ref = buildMagi2Request({ prompt: long, durationSec: 5, startFrameUrl: img(1), referenceImageUrls: [img(2)] })
    expect(String(ref.input.prompt).length).toBeLessThanOrEqual(MAGI_2_PROMPT_MAX)
    expect(String(buildMagi2Request({ prompt: long + "yy", durationSec: 5 }).input.prompt).length).toBe(MAGI_2_PROMPT_MAX)
  })

  it("an image mention loses its @ where no reference is sent", () => {
    expect(String(buildMagi2Request({ prompt: "like @image_1", durationSec: 5, startFrameUrl: img(1) }).input.prompt)).not.toContain("@image_1")
  })

  it("a reference run with a frame and no ratio named follows the frame's shape", () => {
    const run = (aspectRatio: string | undefined, frameAspectRatio: string | undefined) =>
      buildMagi2Request({ prompt: "p", durationSec: 5, aspectRatio, frameAspectRatio, startFrameUrl: img(9), referenceImageUrls: [img(1)] }).input.aspect_ratio
    expect(magi2FrameAspect(1080, 1920)).toBe("9:16")
    expect(magi2FrameAspect(1000, 1250)).toBe("3:4")
    expect(magi2FrameAspect(undefined, 1920)).toBeUndefined()
    expect(run(undefined, "9:16")).toBe("9:16")
    expect(run("adaptive", "9:16")).toBe("9:16")
    // A ratio the request names always wins, an off-list one included.
    expect(run("21:9", "9:16")).toBe("21:9")
    expect(run("5:4", "9:16")).toBe(resolveMagi2Aspect("5:4"))
    // A frame that could not be measured keeps the default.
    expect(run(undefined, undefined)).toBe("16:9")
    expect(magi2NamesShape("4:5")).toBe(true)
    expect(magi2NamesShape("auto")).toBe(false)
    expect(magi2NamesShape(undefined)).toBe(false)
  })

  it("a text run never reads the frame's ratio", () => {
    const { input } = buildMagi2Request({ prompt: "p", durationSec: 5, frameAspectRatio: "9:16" })
    expect(input.aspect_ratio).toBe("16:9")
  })

  it("the aspect ratio is a declared one, snapped otherwise, 16:9 for no shape", () => {
    expect(resolveMagi2Aspect("3:4")).toBe("3:4")
    expect(resolveMagi2Aspect(undefined)).toBe("16:9")
    expect(resolveMagi2Aspect("adaptive")).toBe("16:9")
    expect(getModel("magi-2")?.aspectRatios).toContain(resolveMagi2Aspect("4:5"))
  })

  it("the recorded provider cost grows with every second", () => {
    expect(magi2CostUsd(5)).toBeCloseTo(0.44, 10)
    expect(magi2CostUsd(30)).toBeCloseTo(2.64, 10)
  })

  it("is registered in both model maps with 4-30 s and no content-filter lever", () => {
    for (const cfg of [KIE_VIDEO_MODELS["magi-2"], KIE_TEXT_TO_VIDEO_MODELS["magi-2"]]) {
      expect(cfg?.allowedDurations).toEqual(getModel("magi-2")?.durations)
      expect(cfg?.safetyLevers).toBeUndefined()
    }
    expect(KIE_VIDEO_MODELS["magi-2"]?.model).toBe(MAGI_2_IMAGE_TO_VIDEO_MODEL)
    expect(KIE_TEXT_TO_VIDEO_MODELS["magi-2"]?.model).toBe(MAGI_2_TEXT_TO_VIDEO_MODEL)
  })
})

describe("MAGI-2 render budget", () => {
  const waitedMs = (attempts: number) => Array.from({ length: attempts }, (_, i) => pollDelay(i + 1)).reduce((a, b) => a + b, 0)
  const neededMs = (seconds: number) => seconds * MAGI_2_RENDER_SEC_PER_OUTPUT_SEC * MAGI_2_MARGIN * 1000

  it("a short clip keeps the standard budget and kind", () => {
    for (const duration of [4, 5, 12]) {
      expect(longRenderPollAttempts("magi-2", { resolution: "1080p", duration }, MAX_POLL_ATTEMPTS_VIDEO), `${duration}s`).toBe(MAX_POLL_ATTEMPTS_VIDEO)
      expect(isLongKieVideoRender("magi-2", "1080p", duration), `${duration}s`).toBe(false)
      expect(providerKindForVideoModel("magi-2", { resolution: "1080p", duration }), `${duration}s`).toBe("kie-standard")
    }
    // No length sent: the 5 s default.
    expect(providerKindForVideoModel("magi-2", { resolution: "1080p" })).toBe("kie-standard")
    expect(providerKindForVideoModel("magi-2")).toBe("kie-standard")
  })

  it("a long clip is polled for twice its measured render rate over its seconds, and recorded as a long render", () => {
    for (const duration of [13, 20, 30]) {
      const attempts = longRenderPollAttempts("magi-2", { resolution: "1080p", duration }, MAX_POLL_ATTEMPTS_VIDEO)
      expect(attempts, `${duration}s`).toBeGreaterThan(MAX_POLL_ATTEMPTS_VIDEO)
      expect(waitedMs(attempts), `${duration}s`).toBeGreaterThanOrEqual(neededMs(duration))
      expect(waitedMs(attempts - 1), `${duration}s`).toBeLessThan(neededMs(duration))
      expect(providerKindForVideoModel("magi-2", { resolution: "1080p", duration }), `${duration}s`).toBe("kie-long-video")
    }
    // The measured 30 s render (22 min 42 s) fits inside its budget, which the standard one did not.
    const thirty = longRenderPollAttempts("magi-2", { resolution: "1080p", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)
    expect(waitedMs(thirty)).toBeGreaterThan(1_362_000)
    expect(waitedMs(MAX_POLL_ATTEMPTS_VIDEO)).toBeLessThan(1_362_000)
    // An Auto length is sized on the longest clip.
    expect(longRenderPollAttempts("magi-2", { resolution: "1080p", duration: 0 }, MAX_POLL_ATTEMPTS_VIDEO)).toBe(thirty)
  })

  it("the long kind's staleness threshold is above a 30 s run's poll, and the standard one above a 12 s run's", () => {
    expect(STALE_THRESHOLD_MS["kie-long-video"]).toBeGreaterThan(waitedMs(longRenderPollAttempts("magi-2", { resolution: "1080p", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)))
    expect(STALE_THRESHOLD_MS["kie-standard"]).toBeGreaterThan(waitedMs(longRenderPollAttempts("magi-2", { resolution: "1080p", duration: 12 }, MAX_POLL_ATTEMPTS_VIDEO)))
  })

  it("leaves every other model's budget alone", () => {
    expect(longRenderPollAttempts("seedance-2-5", { resolution: "1080p", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
    expect(longRenderPollAttempts("wan-3", { resolution: "1080p", duration: 30 }, MAX_POLL_ATTEMPTS_VIDEO)).toBe(MAX_POLL_ATTEMPTS_VIDEO)
    expect(providerKindForVideoModel("wan-3", { resolution: "1080p", duration: 30 })).toBe("kie-standard")
  })
})
