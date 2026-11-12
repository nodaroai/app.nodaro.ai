import { describe, it, expect } from "vitest"
import {
  buildPixverseV6MaxRequest,
  pixverseV6MaxSeed,
  resolvePixverseV6MaxAspect,
  PIXVERSE_V6_MAX_DEFAULT_ASPECT,
  PIXVERSE_V6_MAX_DEFAULT_PROMPT,
  PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_FIELDS,
  PIXVERSE_V6_MAX_TEXT_TO_VIDEO_FIELDS,
} from "../pixverse-v6-max.js"
import { PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_MODEL, PIXVERSE_V6_MAX_TEXT_TO_VIDEO_MODEL } from "../models.js"

/**
 * PixVerse V6 Max request bodies (docs.kie.ai/market/pixverse/v6-max-text-to-video
 * and /v6-max-image-to-video, read 2026-11-12): one Nodaro id over two
 * endpoints, each body an explicit allow-list.
 */
const START = "https://cdn.example/start.png"

describe("buildPixverseV6MaxRequest — endpoint choice", () => {
  it("a start frame runs image-to-video: exactly one image, NO aspect ratio", () => {
    const { model, input } = buildPixverseV6MaxRequest({ prompt: "she turns", durationSec: 5, startFrameUrl: START, aspectRatio: "9:16" })
    expect(model).toBe(PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_MODEL)
    expect(model).toBe("pixverse-v6-max/image-to-video")
    expect(input.image_urls).toEqual([START])
    expect(input).not.toHaveProperty("aspect_ratio")
  })

  it("no image runs text-to-video with a required aspect ratio", () => {
    const { model, input } = buildPixverseV6MaxRequest({ prompt: "a city at night", durationSec: 5, aspectRatio: "21:9" })
    expect(model).toBe(PIXVERSE_V6_MAX_TEXT_TO_VIDEO_MODEL)
    expect(model).toBe("pixverse-v6-max/text-to-video")
    expect(input.aspect_ratio).toBe("21:9")
    expect(input).not.toHaveProperty("image_urls")
  })

  it("a blank start frame is no start frame", () => {
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, startFrameUrl: "  " }).model).toBe(PIXVERSE_V6_MAX_TEXT_TO_VIDEO_MODEL)
  })
})

describe("buildPixverseV6MaxRequest — the allow-list", () => {
  it("each body carries only its schema's keys", () => {
    const i2v = buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, startFrameUrl: START, seed: 7 }).input
    expect(Object.keys(i2v).sort()).toEqual([...PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_FIELDS].sort())
    const t2v = buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, seed: 7 }).input
    expect(Object.keys(t2v).sort()).toEqual([...PIXVERSE_V6_MAX_TEXT_TO_VIDEO_FIELDS].sort())
  })

  it("matches the documented key sets exactly", () => {
    expect([...PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_FIELDS].sort()).toEqual(["duration", "generate_audio_switch", "image_urls", "prompt", "quality", "seed"])
    expect([...PIXVERSE_V6_MAX_TEXT_TO_VIDEO_FIELDS].sort()).toEqual(["aspect_ratio", "duration", "generate_audio_switch", "prompt", "quality", "seed"])
  })

  it("duration is an integer, quality the lowercase enum", () => {
    const { input } = buildPixverseV6MaxRequest({ prompt: "p", durationSec: 12, resolution: "1080P" })
    expect(input.duration).toBe(12)
    expect(typeof input.duration).toBe("number")
    expect(input.quality).toBe("1080p")
    expect(input).not.toHaveProperty("resolution")
  })

  it("an omitted or unknown quality is 720p, never the 360p preview tier", () => {
    for (const resolution of [undefined, "", "480p", "4k", "nonsense"]) {
      expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, resolution }).input.quality, String(resolution)).toBe("720p")
    }
    for (const q of ["360p", "540p", "720p", "1080p"]) {
      expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, resolution: q }).input.quality).toBe(q)
    }
  })

  it("an empty prompt is sent as the platform default (KIE needs one character)", () => {
    expect(buildPixverseV6MaxRequest({ prompt: "   ", durationSec: 5 }).input.prompt).toBe(PIXVERSE_V6_MAX_DEFAULT_PROMPT)
    expect(buildPixverseV6MaxRequest({ prompt: "keep me", durationSec: 5 }).input.prompt).toBe("keep me")
  })
})

describe("buildPixverseV6MaxRequest — the audio switch", () => {
  it("is sent ON when the request names no audio setting (KIE's own default is off)", () => {
    for (const startFrameUrl of [undefined, START]) {
      expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, startFrameUrl }).input.generate_audio_switch).toBe(true)
    }
  })

  it("follows `sound`, else `generateAudio`, both ways", () => {
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, audio: { sound: false } }).input.generate_audio_switch).toBe(false)
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, audio: { sound: true } }).input.generate_audio_switch).toBe(true)
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, startFrameUrl: START, audio: { sound: false } }).input.generate_audio_switch).toBe(false)
    // The Generate Video Pro engine sends `generateAudio` alone.
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, audio: { generateAudio: false } }).input.generate_audio_switch).toBe(false)
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, audio: { generateAudio: true } }).input.generate_audio_switch).toBe(true)
    // `sound` wins when both are sent.
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, audio: { sound: true, generateAudio: false } }).input.generate_audio_switch).toBe(true)
  })

  it("never writes another model's audio key", () => {
    const { input } = buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, audio: { sound: false } })
    for (const key of ["sound", "audio", "generate_audio"]) expect(input).not.toHaveProperty(key)
  })
})

describe("the seed", () => {
  it("is sent only as a whole number 0-2147483647", () => {
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, seed: 123456 }).input.seed).toBe(123456)
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, seed: 0 }).input.seed).toBe(0)
    expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, seed: 2147483647 }).input.seed).toBe(2147483647)
    // The route's "-1 = random", a fraction and an out-of-range seed are left out.
    for (const seed of [-1, 1.5, 2147483648, Number.NaN, undefined]) {
      expect(buildPixverseV6MaxRequest({ prompt: "p", durationSec: 5, seed }).input, String(seed)).not.toHaveProperty("seed")
      expect(pixverseV6MaxSeed(seed)).toBeUndefined()
    }
  })
})

describe("the text-to-video aspect ratio", () => {
  it("passes a declared ratio through and snaps anything else", () => {
    for (const r of ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"]) {
      expect(resolvePixverseV6MaxAspect(r)).toBe(r)
    }
    // The shared route enum lets these in; each lands on the nearest declared shape.
    expect(resolvePixverseV6MaxAspect("9:21")).toBe("9:16")
    expect(resolvePixverseV6MaxAspect("4:5")).toBe("3:4")
    expect(resolvePixverseV6MaxAspect("5:4")).toBe("4:3")
  })

  it("no shape at all is 16:9", () => {
    expect(PIXVERSE_V6_MAX_DEFAULT_ASPECT).toBe("16:9")
    for (const r of [undefined, "", "auto", "Auto", "adaptive"]) {
      expect(resolvePixverseV6MaxAspect(r), String(r)).toBe("16:9")
    }
  })
})

describe("image mentions in the prompt", () => {
  // The model takes no reference images: a platform `@image_N` (a reference, or
  // a cast member's seat in a Generate Video Pro segment) points at nothing.
  it("drop their `@` on both endpoints, in every spelling, and leave other text alone", () => {
    const prompt = "@image_1 walks to @image2, then @image(3) waves; mail a@b.co, @imagery stays"
    const want = "image_1 walks to image2, then image(3) waves; mail a@b.co, @imagery stays"
    expect(buildPixverseV6MaxRequest({ prompt, durationSec: 5, startFrameUrl: START }).input.prompt).toBe(want)
    expect(buildPixverseV6MaxRequest({ prompt, durationSec: 5 }).input.prompt).toBe(want)
  })

  it("a prompt with no mention is sent as written", () => {
    expect(buildPixverseV6MaxRequest({ prompt: "a lighthouse in a storm", durationSec: 5 }).input.prompt).toBe("a lighthouse in a storm")
  })
})
