// @test-always pure request builder — reads no files
import { describe, it, expect } from "vitest"
import { buildKling4Request, kling4FlashEndpoint, kling4Mentions, type Kling4RequestArgs } from "../kling4.js"
import { KLING_4_FLASH_KEYFRAME_MODEL, KLING_4_FLASH_REFERENCE_MODEL } from "../models.js"

const IMG = (n: number) => `https://cdn.example/img${n}.png`
const VID = (n: number) => `https://cdn.example/vid${n}.mp4`
const AUD = (n: number) => `https://cdn.example/aud${n}.mp3`

/**
 * The properties each Flash schema allows (both are `additionalProperties:
 * false`, docs.kie.ai/market/kling/v4-flash-reference-to-video and
 * /v4-flash-keyframe-to-video, read 2026-11-11). A key outside these is a 422.
 */
const REFERENCE_KEYS = ["prompt", "image_urls", "video_urls", "keep_original_sound", "duration", "resolution", "aspect_ratio", "elements"]
const ELEMENT_KEYS = ["name", "type", "image_urls", "video_url", "tag", "description", "voice_url"]
const KEYFRAME_KEYS = ["prompt", "first_frame_url", "duration", "resolution", "aspect_ratio"]

const flash = (over: Partial<Kling4RequestArgs> = {}): Kling4RequestArgs => ({
  provider: "kling-4-flash",
  prompt: "a quiet street at dawn",
  durationSec: 5,
  ...over,
})

/** A character with `n` images (2-4 makes a subject; 1 stays a reference image). */
const character = (name: string, n: number, base: number) => ({
  name,
  imageUrl: IMG(base),
  ...(n > 1 ? { extraImageUrls: Array.from({ length: n - 1 }, (_, i) => IMG(base + i + 1)) } : {}),
  description: `${name} in a red coat`,
})

function declaredNames(input: Record<string, unknown>): Set<string> {
  const names = new Set<string>()
  ;(input.image_urls as string[] | undefined)?.forEach((_, i) => names.add(`image_${i + 1}`))
  ;(input.video_urls as string[] | undefined)?.forEach((_, i) => names.add(`video_${i + 1}`))
  if (input.first_frame_url) names.add("first_frame")
  ;(input.elements as Array<{ name: string }> | undefined)?.forEach((e) => names.add(e.name))
  return names
}

function expectAllowListedBody(model: string, input: Record<string, unknown>): void {
  const allowed = model === KLING_4_FLASH_KEYFRAME_MODEL ? KEYFRAME_KEYS : REFERENCE_KEYS
  for (const key of Object.keys(input)) expect(allowed, `${key} on ${model}`).toContain(key)
  for (const el of (input.elements as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const key of Object.keys(el)) expect(ELEMENT_KEYS, `element key ${key}`).toContain(key)
  }
  // Every mention is a material the body carries — KIE refuses the run otherwise.
  const declared = declaredNames(input)
  for (const m of kling4Mentions(input.prompt as string)) {
    expect(declared.has(m), `@${m} is not declared in ${JSON.stringify(input)}`).toBe(true)
  }
  expect(input.resolution).toBe("720p")
  expect(input).not.toHaveProperty("voices")
  expect(input).not.toHaveProperty("last_frame_url")
  expect(input).not.toHaveProperty("keyframe_urls")
  expect(Number.isInteger(input.duration)).toBe(true)
}

describe("kling4FlashEndpoint — which endpoint a run takes (decided 2026-11-11)", () => {
  it("a start frame with nothing else runs keyframe-to-video", () => {
    expect(kling4FlashEndpoint({ startFrameUrl: IMG(1) })).toBe("keyframe")
  })

  it("anything else runs reference-to-video", () => {
    expect(kling4FlashEndpoint({})).toBe("reference")
    expect(kling4FlashEndpoint({ referenceImageUrls: [IMG(1)] })).toBe("reference")
    expect(kling4FlashEndpoint({ startFrameUrl: IMG(9), referenceImageUrls: [IMG(1)] })).toBe("reference")
    expect(kling4FlashEndpoint({ startFrameUrl: IMG(9), referenceVideoUrls: [VID(1)] })).toBe("reference")
    expect(kling4FlashEndpoint({ startFrameUrl: IMG(9), characterReferences: [character("Maya", 2, 10)] })).toBe("reference")
    // A one-image character still reaches the model, as a reference image.
    expect(kling4FlashEndpoint({ startFrameUrl: IMG(9), characterReferences: [character("Maya", 1, 10)] })).toBe("reference")
  })

  it("ignores blank entries and audio when deciding", () => {
    expect(kling4FlashEndpoint({ startFrameUrl: IMG(9), referenceImageUrls: [" ", ""], referenceVideoUrls: [""] })).toBe("keyframe")
    expect(kling4FlashEndpoint({ startFrameUrl: "  " })).toBe("reference")
  })
})

describe("buildKling4Request — Kling 4.0 Flash, keyframe endpoint", () => {
  it("a start frame alone: the exact opening frame, an allow-listed body, no aspect ratio", () => {
    const { model, input, notes } = buildKling4Request(flash({ startFrameUrl: IMG(1), aspectRatio: "9:16", resolution: "1080p" }))
    expect(model).toBe(KLING_4_FLASH_KEYFRAME_MODEL)
    expect(input).toEqual({ prompt: "a quiet street at dawn", duration: 5, resolution: "720p", first_frame_url: IMG(1) })
    expect(notes).toEqual([])
    expectAllowListedBody(model, input)
  })

  it("names the frame @first_frame: @image_1 (its reference-endpoint seat) maps there, any other mention loses its @", () => {
    const { input } = buildKling4Request(flash({ startFrameUrl: IMG(1), prompt: "@image_1 slowly turns; @image_2 and @Maya stay; @first_frame glows" }))
    expect(input.prompt).toBe("@first_frame slowly turns; image_2 and Maya stay; @first_frame glows")
  })

  it("drops reference audio with a note — no character to carry it", () => {
    const { model, input, notes } = buildKling4Request(flash({ startFrameUrl: IMG(1), referenceAudioUrls: [AUD(1)], prompt: "she sings @audio_1" }))
    expect(model).toBe(KLING_4_FLASH_KEYFRAME_MODEL)
    expect(input.prompt).toBe("she sings audio_1")
    expect(notes.join(" ")).toMatch(/dropped 1 reference audio clip\(s\).*no character that can carry one/)
    expectAllowListedBody(model, input)
  })

  it("drops an end frame with a note; it never reaches the wire", () => {
    const { model, input, notes } = buildKling4Request(flash({ startFrameUrl: IMG(1), endFrameUrl: IMG(2) }))
    expect(model).toBe(KLING_4_FLASH_KEYFRAME_MODEL)
    expect(JSON.stringify(input)).not.toContain(IMG(2))
    expect(notes).toContain("dropped the end frame: Kling 4.0 Flash takes none")
  })
})

describe("buildKling4Request — Kling 4.0 Flash, reference endpoint", () => {
  it("a prompt alone is plain text-to-video on the reference endpoint, at 720p whatever was asked", () => {
    const { model, input } = buildKling4Request(flash({ resolution: "1080p", aspectRatio: "auto" }))
    expect(model).toBe(KLING_4_FLASH_REFERENCE_MODEL)
    expect(input).toEqual({ prompt: "a quiet street at dawn", duration: 5, resolution: "720p", aspect_ratio: "auto" })
  })

  it("a start frame beside references joins the reference images after the caller's own", () => {
    const { model, input } = buildKling4Request(flash({ prompt: "@image_1 waves", startFrameUrl: IMG(9), referenceImageUrls: [IMG(1)] }))
    expect(model).toBe(KLING_4_FLASH_REFERENCE_MODEL)
    expect(input.image_urls).toEqual([IMG(1), IMG(9)])
    expect(input.prompt).toContain("@image_2")
    expectAllowListedBody(model, input)
  })

  it("sends reference videos with keep_original_sound", () => {
    const { input } = buildKling4Request(flash({ referenceVideoUrls: [VID(1)], keepOriginalSound: true, prompt: "move like @video_1" }))
    expect(input.video_urls).toEqual([VID(1)])
    expect(input.keep_original_sound).toBe(true)
    expect(input.prompt).toBe("move like @video_1")
  })

  it("binds clip N to character N: all subjects, each its own voice_url — never a voices array", () => {
    const { model, input, notes } = buildKling4Request(flash({
      prompt: "@Maya greets @Kira in the voice of @audio_1",
      characterReferences: [character("Maya", 2, 10), character("Kira", 3, 20)],
      referenceAudioUrls: [AUD(1), AUD(2)],
    }))
    expect(input.elements).toEqual([
      { name: "Maya", image_urls: [IMG(10), IMG(11)], tag: "character", description: "Maya in a red coat", voice_url: AUD(1) },
      { name: "Kira", image_urls: [IMG(20), IMG(21), IMG(22)], tag: "character", description: "Kira in a red coat", voice_url: AUD(2) },
    ])
    // A clip cannot be mentioned on Flash: @audio_N loses its @.
    expect(input.prompt).toBe("@Maya greets @Kira in the voice of audio_1")
    expect(notes).toEqual([])
    expectAllowListedBody(model, input)
  })

  it("follows wired-character order: A (portrait only) then B (portrait + a variant) — B gets B's clip, A's clip is dropped", () => {
    const { input, notes } = buildKling4Request(flash({
      characterReferences: [character("Anna", 1, 30), character("Ben", 2, 10)],
      referenceAudioUrls: [AUD(1), AUD(2)],
    }))
    // Anna, with one image, is a plain reference image and cannot carry a voice.
    expect(input.image_urls).toEqual([IMG(30)])
    expect(input.elements).toEqual([
      { name: "Ben", image_urls: [IMG(10), IMG(11)], tag: "character", description: "Ben in a red coat", voice_url: AUD(2) },
    ])
    expect(JSON.stringify(input)).not.toContain(AUD(1))
    expect(notes).toEqual(["dropped reference audio clip 1: character 1 has fewer than 2 images, so it cannot carry a voice"])
  })

  it("drops every clip past the last wired character", () => {
    const { input, notes } = buildKling4Request(flash({
      characterReferences: [character("Maya", 2, 10)],
      referenceAudioUrls: [AUD(1), AUD(2), AUD(3)],
    }))
    expect(input.elements).toEqual([
      { name: "Maya", image_urls: [IMG(10), IMG(11)], tag: "character", description: "Maya in a red coat", voice_url: AUD(1) },
    ])
    expect(JSON.stringify(input)).not.toContain(AUD(2))
    expect(JSON.stringify(input)).not.toContain(AUD(3))
    expect(notes).toEqual([
      "dropped reference audio clip 2: no character 2 is connected to carry it",
      "dropped reference audio clip 3: no character 3 is connected to carry it",
    ])
  })

  it("with no character wired, every clip is dropped and the run still builds", () => {
    const { model, input, notes } = buildKling4Request(flash({ referenceImageUrls: [IMG(1)], referenceAudioUrls: [AUD(1)] }))
    expect(model).toBe(KLING_4_FLASH_REFERENCE_MODEL)
    expect(JSON.stringify(input)).not.toContain(AUD(1))
    expect(input).not.toHaveProperty("elements")
    expect(notes).toEqual(["dropped reference audio clip 1: no character 1 is connected to carry it"])
  })

  it("drops an end frame with a note — it never joins the reference images", () => {
    const { input, notes } = buildKling4Request(flash({ startFrameUrl: IMG(9), endFrameUrl: IMG(8), referenceImageUrls: [IMG(1)] }))
    expect(input.image_urls).toEqual([IMG(1), IMG(9)])
    expect(JSON.stringify(input)).not.toContain(IMG(8))
    expect(notes).toContain("dropped the end frame: Kling 4.0 Flash takes none")
  })
})

describe("Kling 4.0 Flash — every body is allow-listed and every mention declared", () => {
  it("holds over a sweep of wiring shapes on both endpoints", () => {
    const prompts = [
      "@image_1 @image_2 @image_3 @video_1 @video_2 @audio_1 @audio_3 @Maya @Kira @first_frame @keyframe_2 @last_frame",
      "the person from @image_2 meets the person from @image_4 — @image_10",
    ]
    let keyframeRuns = 0
    for (const prompt of prompts) {
      for (let images = 0; images <= 3; images++) {
        for (const videos of [0, 2]) {
          for (const audio of [0, 1, 3]) {
            for (const chars of [0, 1, 2]) {
              for (const frames of [[], ["start"], ["end"], ["start", "end"]] as const) {
                for (const resolution of [undefined, "720p", "1080p"]) {
                  const { model, input } = buildKling4Request(flash({
                    prompt,
                    resolution,
                    aspectRatio: "16:9",
                    durationSec: 12,
                    referenceImageUrls: Array.from({ length: images }, (_, i) => IMG(i + 1)),
                    referenceVideoUrls: Array.from({ length: videos }, (_, i) => VID(i + 1)),
                    referenceAudioUrls: Array.from({ length: audio }, (_, i) => AUD(i + 1)),
                    startFrameUrl: frames.includes("start" as never) ? IMG(90) : undefined,
                    endFrameUrl: frames.includes("end" as never) ? IMG(91) : undefined,
                    characterReferences: [character("Maya", 3, 40), character("Kira", 1, 60)].slice(0, chars),
                  }))
                  if (model === KLING_4_FLASH_KEYFRAME_MODEL) keyframeRuns++
                  expectAllowListedBody(model, input)
                  expect(JSON.stringify(input)).not.toContain(IMG(91))
                }
              }
            }
          }
        }
      }
    }
    expect(keyframeRuns).toBeGreaterThan(0)
  })
})
