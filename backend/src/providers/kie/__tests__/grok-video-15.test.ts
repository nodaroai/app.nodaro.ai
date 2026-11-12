import { describe, it, expect } from "vitest"
import {
  buildGrokVideo15Request,
  grokVideo15KeyframeTimestamps,
  neutralizeGrokVideo15Mentions,
  GROK_VIDEO_15_START_FRAME_TRANSPORT,
  type GrokVideo15RequestArgs,
  type GrokVideo15StartFrameTransport,
} from "../grok-video-15.js"

/**
 * Grok Imagine Video 1.5 bodies (docs.kie.ai/market/grok-imagine/1-5-preview).
 * The schema's `input` is `additionalProperties: false`: every key here must be
 * one the schema lists, and the frames, the loop and the in-between frames must
 * land on their own fields (decided 2026-11-11).
 */
const SCHEMA_KEYS = new Set([
  "prompt", "image_urls", "aspect_ratio", "resolution", "duration",
  "first_frame_url", "last_frame_url", "loop_url", "keyframes", "enable_audio", "nsfw_checker",
])
const START = "https://cdn.example/start.png"
const END = "https://cdn.example/end.png"
const MID = (n: number) => `https://cdn.example/mid-${n}.png`
const BOTH: GrokVideo15StartFrameTransport[] = ["first-frame-only", "first-frame-and-image-urls"]

const build = (over: Partial<GrokVideo15RequestArgs> = {}) =>
  buildGrokVideo15Request({ prompt: "she turns to the window", durationSec: 8, startFrameUrl: START, ...over })

describe("the start frame's transport", () => {
  it("defaults to the first frame alone", () => {
    expect(GROK_VIDEO_15_START_FRAME_TRANSPORT).toBe("first-frame-only")
    expect(build().input).toEqual({
      prompt: "she turns to the window",
      aspect_ratio: "auto",
      resolution: "480p",
      duration: 8,
      nsfw_checker: false,
      first_frame_url: START,
    })
  })

  it("the second body also carries the start image in image_urls (one entry)", () => {
    expect(build({ transport: "first-frame-and-image-urls" }).input).toEqual({
      prompt: "she turns to the window",
      aspect_ratio: "auto",
      resolution: "480p",
      duration: 8,
      nsfw_checker: false,
      image_urls: [START],
      first_frame_url: START,
    })
  })
})

describe("frames", () => {
  it("start + end: the exact first and last frame", () => {
    for (const transport of BOTH) {
      const { input } = build({ endFrameUrl: END, transport })
      expect(input.first_frame_url).toBe(START)
      expect(input.last_frame_url).toBe(END)
      expect(input.loop_url).toBeUndefined()
      expect(input.image_urls).toEqual(transport === "first-frame-and-image-urls" ? [START] : undefined)
    }
  })

  it("the same image as start and end is a loop: loop_url alone, no first or last frame", () => {
    for (const transport of BOTH) {
      const { input, notes } = build({ endFrameUrl: ` ${START} `, transport })
      expect(input.loop_url).toBe(START)
      expect(input.first_frame_url).toBeUndefined()
      expect(input.last_frame_url).toBeUndefined()
      expect(input.image_urls).toEqual(transport === "first-frame-and-image-urls" ? [START] : undefined)
      expect(notes.join(" ")).toMatch(/loop_url/)
    }
  })

  it("no start image: neither a first frame nor a loop (the runner refuses it)", () => {
    const { input } = build({ startFrameUrl: undefined, endFrameUrl: END })
    expect(input.first_frame_url).toBeUndefined()
    expect(input.loop_url).toBeUndefined()
    expect(input.last_frame_url).toBe(END)
    expect(input.image_urls).toBeUndefined()
  })
})

describe("in-between frames", () => {
  it("start + 2 in-between + end at 8s: whole seconds 3 and 5, in order", () => {
    const { input, notes } = build({ endFrameUrl: END, inBetweenFrameUrls: [MID(1), MID(2)] })
    expect(input.keyframes).toEqual([
      { url: MID(1), timestamp_s: 3 },
      { url: MID(2), timestamp_s: 5 },
    ])
    expect(input.first_frame_url).toBe(START)
    expect(input.last_frame_url).toBe(END)
    expect(notes).toEqual([])
  })

  it("start + 4 in-between at 3s: the first two fit (1s, 2s), the last two are dropped with a note", () => {
    const { input, notes } = build({ durationSec: 3, inBetweenFrameUrls: [MID(1), MID(2), MID(3), MID(4)] })
    expect(input.keyframes).toEqual([
      { url: MID(1), timestamp_s: 1 },
      { url: MID(2), timestamp_s: 2 },
    ])
    expect(notes).toEqual(["dropped 2 in-between frame(s): a 3s clip takes 2 (one per whole second inside the clip, at most 4)"])
  })

  it("never more than 4, and none on a 1s clip", () => {
    const six = [1, 2, 3, 4, 5, 6].map(MID)
    expect((build({ durationSec: 15, inBetweenFrameUrls: six }).input.keyframes as unknown[]).length).toBe(4)
    const one = build({ durationSec: 1, inBetweenFrameUrls: [MID(1)] })
    expect(one.input.keyframes).toBeUndefined()
    expect(one.notes[0]).toMatch(/dropped 1 in-between frame/)
  })

  it("they are frames only — never image_urls references", () => {
    for (const transport of BOTH) {
      const { input } = build({ inBetweenFrameUrls: [MID(1), MID(2)], transport })
      expect(input.image_urls ?? []).not.toContain(MID(1))
      expect(input.image_urls ?? []).not.toContain(MID(2))
    }
  })

  it("timestamps are whole seconds, strictly inside the clip, strictly increasing, for every length and count", () => {
    for (let d = 1; d <= 15; d++) {
      for (let count = 0; count <= 6; count++) {
        const ts = grokVideo15KeyframeTimestamps(count, d)
        expect(ts.length, `${count} at ${d}s`).toBe(Math.max(0, Math.min(count, d - 1)))
        ts.forEach((t, i) => {
          expect(Number.isInteger(t)).toBe(true)
          expect(t).toBeGreaterThan(0)
          expect(t).toBeLessThan(d)
          if (i > 0) expect(t - ts[i - 1]!).toBeGreaterThanOrEqual(1)
        })
      }
    }
    expect(grokVideo15KeyframeTimestamps(4, 15)).toEqual([3, 6, 9, 12])
    expect(grokVideo15KeyframeTimestamps(1, 8)).toEqual([4])
  })
})

describe("levers", () => {
  it("one resolution normalizer: case folded, anything else 480p", () => {
    expect(build({ resolution: "1080P" }).input.resolution).toBe("1080p")
    expect(build({ resolution: "720p" }).input.resolution).toBe("720p")
    expect(build({ resolution: "4k" }).input.resolution).toBe("480p")
    expect(build({ resolution: undefined }).input.resolution).toBe("480p")
  })

  it("aspect ratio: a catalog ratio passes, Auto/adaptive/off-list become auto", () => {
    expect(build({ aspectRatio: "9:16" }).input.aspect_ratio).toBe("9:16")
    expect(build({ aspectRatio: "Auto" }).input.aspect_ratio).toBe("auto")
    expect(build({ aspectRatio: "adaptive" }).input.aspect_ratio).toBe("auto")
    expect(build({ aspectRatio: "21:9" }).input.aspect_ratio).toBe("auto")
  })

  it("duration is an integer", () => {
    expect(build({ durationSec: 12 }).input.duration).toBe(12)
  })
})

describe("mentions", () => {
  const prompt = "@image_1 walks to @image1, then @Image3 and @image(2); mail@image1x stays"

  it("no image mention stays live when the start image does not ride image_urls", () => {
    expect(neutralizeGrokVideo15Mentions(prompt, false)).toBe("image_1 walks to image1, then Image3 and image(2); mail@image1x stays")
  })

  it("only @image1 (the start image in image_urls) stays live under the second transport", () => {
    expect(neutralizeGrokVideo15Mentions(prompt, true)).toBe("image_1 walks to @image1, then Image3 and image(2); mail@image1x stays")
  })

  it("the builder applies it per transport", () => {
    expect(build({ prompt }).input.prompt).not.toMatch(/@image1(?![\w])/)
    expect(build({ prompt, transport: "first-frame-and-image-urls" }).input.prompt).toMatch(/@image1,/)
    expect(build({ prompt, startFrameUrl: undefined, transport: "first-frame-and-image-urls" }).input.prompt).not.toMatch(/@image1,/)
  })
})

describe("allow-list sweep", () => {
  it("every body keeps to the schema's keys, whatever is wired", () => {
    const starts = [undefined, START]
    const ends = [undefined, END, START]
    const middles = [[], [MID(1)], [MID(1), MID(2), MID(3), MID(4), MID(5)]]
    for (const transport of BOTH) {
      for (const startFrameUrl of starts) {
        for (const endFrameUrl of ends) {
          for (const inBetweenFrameUrls of middles) {
            for (const durationSec of [1, 3, 8, 15]) {
              const { input } = build({ transport, startFrameUrl, endFrameUrl, inBetweenFrameUrls, durationSec, resolution: "1080p", aspectRatio: "21:9", prompt: "@image_2 and @image1" })
              for (const key of Object.keys(input)) expect(SCHEMA_KEYS.has(key), key).toBe(true)
              expect(Object.keys(input)).not.toContain("enable_audio")
              expect(input.loop_url !== undefined && (input.first_frame_url !== undefined || input.last_frame_url !== undefined)).toBe(false)
              expect(((input.image_urls as unknown[] | undefined) ?? []).length).toBeLessThanOrEqual(1)
              expect(((input.keyframes as unknown[] | undefined) ?? []).length).toBeLessThanOrEqual(4)
              const live = [...String(input.prompt).matchAll(/@image\S*/g)].map((m) => m[0])
              expect(live.every((m) => m.startsWith("@image1") && input.image_urls !== undefined)).toBe(true)
            }
          }
        }
      }
    }
  })
})
