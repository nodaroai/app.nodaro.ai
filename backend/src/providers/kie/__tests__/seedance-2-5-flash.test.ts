import { describe, it, expect } from "vitest"
import { applySeedance2Params } from "../video.js"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../models.js"
import { referenceVideoMaxBytes, SEEDANCE_2_5_REF_VIDEO_MAX_BYTES } from "../reference-video-reencode.js"
import { sentReferenceAudioUrls } from "../../../lib/ref-audio-probe.js"

/**
 * Seedance 2.5 Flash's request body, as the provider sends it for every input
 * shape (docs.kie.ai/market/bytedance/seedance-2-5-flash): the extraParams
 * (`duration: 8` always — the schema has no default), then the Seedance 2
 * family's `applySeedance2Params`. Never `draft`, `output_format` or `seed`;
 * frame requests send `adaptive`.
 */
const ID = "seedance-2-5-flash"
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

describe("seedance-2-5-flash KIE configs", () => {
  it("is registered for i2v and t2v against KIE's Flash model, with its own levers", () => {
    for (const cfg of [KIE_VIDEO_MODELS[ID], KIE_TEXT_TO_VIDEO_MODELS[ID]]) {
      expect(cfg?.model).toBe("bytedance/seedance-2-5-flash")
      expect(cfg?.omitSeed).toBe(true)
      expect(cfg?.extraParams?.resolution).toBe("720p")
      expect(cfg?.extraParams?.duration).toBe(8)
      expect(cfg?.extraParams).not.toHaveProperty("draft")
      expect(cfg?.extraParams).not.toHaveProperty("output_format")
      expect(cfg?.allowedDurations?.[0]).toBe(4)
      expect(cfg?.allowedDurations?.at(-1)).toBe(30)
      expect(cfg?.safetyLevers?.length).toBeGreaterThan(0)
    }
    expect(KIE_VIDEO_MODELS[ID]?.endFrameParam).toBe("last_frame_url")
  })

  it("re-encodes reference videos to the documented 200 MB cap", () => {
    expect(referenceVideoMaxBytes(ID)).toBe(SEEDANCE_2_5_REF_VIDEO_MAX_BYTES)
  })
})

describe("seedance-2-5-flash request bodies", () => {
  const shapes: Array<[string, Record<string, unknown>, Parameters<typeof applySeedance2Params>[1]]> = [
    ["text", {}, { aspectRatio: "16:9" }],
    ["first frame", { first_frame_url: IMG }, { aspectRatio: "16:9" }],
    ["first + last frame", { first_frame_url: IMG, last_frame_url: IMG2 }, { aspectRatio: "9:16" }],
    ["references", {}, { aspectRatio: "16:9", referenceImageUrls: [IMG], referenceVideoUrls: [VID], referenceAudioUrls: [AUD] }],
    ["audio only", {}, { aspectRatio: "16:9", referenceAudioUrls: [AUD] }],
    ["edit", {}, { aspectRatio: "adaptive", referenceVideoUrls: [VID], referenceTaskType: "edit" }],
  ]

  for (const [name, base, options] of shapes) {
    it(`${name}: always names a length, never draft / output_format / seed`, () => {
      const input = body(base, { ...options, draft: true, seed: 7 } as never)
      expect(input.duration, name).toBeDefined()
      expect(input, name).not.toHaveProperty("draft")
      expect(input, name).not.toHaveProperty("output_format")
      expect(input, name).not.toHaveProperty("seed")
      expect(input.resolution, name).toBe("720p")
    })
  }

  it("a first-frame and a first+last-frame request send adaptive, whatever ratio was asked", () => {
    expect(body({ first_frame_url: IMG }, { aspectRatio: "16:9" }).aspect_ratio).toBe("adaptive")
    const pair = body({ first_frame_url: IMG, last_frame_url: IMG2 }, { aspectRatio: "9:16" })
    expect(pair.aspect_ratio).toBe("adaptive")
    expect(pair.first_frame_url).toBe(IMG)
    expect(pair.last_frame_url).toBe(IMG2)
  })

  it("a text request keeps the ratio asked", () => {
    expect(body({}, { aspectRatio: "21:9" }).aspect_ratio).toBe("21:9")
  })

  it("an audio-only reference request is sent as reference audio alone", () => {
    const input = body({}, { aspectRatio: "16:9", referenceAudioUrls: [AUD] })
    expect(input.reference_audio_urls).toEqual([AUD])
    expect(input).not.toHaveProperty("reference_image_urls")
    expect(input).not.toHaveProperty("reference_video_urls")
    expect(input).not.toHaveProperty("first_frame_url")
  })

  it("caps references at 10 images / 5 videos / 5 audio", () => {
    const many = (p: string, n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${p}${i}`)
    const input = body({}, { referenceImageUrls: many("i", 14), referenceVideoUrls: many("v", 8), referenceAudioUrls: many("a", 8) })
    expect((input.reference_image_urls as string[]).length).toBe(10)
    expect((input.reference_video_urls as string[]).length).toBe(5)
    expect((input.reference_audio_urls as string[]).length).toBe(5)
  })

  it("declares the edit task type in its edit shape", () => {
    const input = body({ aspect_ratio: "adaptive", duration: -1 }, { aspectRatio: "adaptive", referenceVideoUrls: [VID], referenceTaskType: "edit" })
    expect(input.omni_reference_task_type).toBe("edit")
  })
})

describe("the Lip Sync lane's voice line is checked as reference audio", () => {
  it("a Seedance lip-sync run sends its audio as reference audio 1", () => {
    expect(sentReferenceAudioUrls({ provider: ID, audioUrl: AUD, lipSync: true })).toEqual([AUD])
    expect(sentReferenceAudioUrls({ provider: ID, audioUrl: AUD, referenceAudioUrls: ["x"], lipSync: true })).toEqual([AUD, "x"])
  })

  it("anything else is its own reference audio, unchanged", () => {
    expect(sentReferenceAudioUrls({ provider: ID, audioUrl: AUD, referenceAudioUrls: ["x"], lipSync: false })).toEqual(["x"])
    expect(sentReferenceAudioUrls({ provider: "omnihuman-2-0", audioUrl: AUD, lipSync: true })).toBeUndefined()
  })
})
