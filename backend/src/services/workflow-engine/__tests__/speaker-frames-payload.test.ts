/**
 * The Speaker Frames job a workflow run enqueues (P3.6), on the inputs the run
 * hands it:
 *  - an edit AND a bare video wired together is refused (P3.4, as the route
 *    and the plugin refuse it), never silently run on the edit alone;
 *  - a camera left unticked from an earlier wiring is dropped from the untick
 *    list, not sent: the panel cannot show or re-tick it, so keeping it would
 *    fail every run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const flag = vi.hoisted(() => ({ priced: false }))
vi.mock("@nodaro/render-rules", async (orig) => {
  const actual = await orig<typeof import("@nodaro/render-rules")>()
  return {
    ...actual,
    get SPEAKER_FRAMES_PRICED() {
      return flag.priced
    },
  }
})

import { buildSpeakerFramesPayload } from "../speaker-frames-payload.js"

const EDL = {
  version: 1,
  clock: "master",
  sources: [
    { id: "mic", url: "https://media.example/mic.wav", kind: "audio", role: "master-audio" },
    { id: "camA", url: "https://media.example/cam-a.mp4", kind: "video" },
  ],
  segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA" }],
}

const build = (over: Partial<Parameters<typeof buildSpeakerFramesPayload>[0]> = {}) =>
  buildSpeakerFramesPayload({ nodeId: "sf", jobId: "job-1", data: {}, ...over })

beforeEach(() => {
  flag.priced = false
})

describe("buildSpeakerFramesPayload", () => {
  it("refuses an edit and a bare video wired together, in the scope's words — not a run on the edit alone", () => {
    expect(() => build({ edits: [JSON.stringify(EDL)], videoUrl: "https://media.example/v.mp4" })).toThrow(/wire exactly one of an edit/)
    expect(() => build({ edl: EDL, videoUrl: "https://media.example/v.mp4" })).toThrow(/wire exactly one of an edit/)
  })

  it("a stale untick (a camera the rewired edit no longer has) does not refuse the run", () => {
    // Unpriced, the run reaches the price refusal — past the scope.
    expect(() => build({ edits: [JSON.stringify(EDL)], data: { excludeSourceIds: ["camB"] } })).toThrow("Speaker Frames is not priced yet")
  })

  it("with a price, sends only the untick ids the current edit samples", () => {
    flag.priced = true
    const twoCams = { ...EDL, sources: [...EDL.sources, { id: "camB", url: "https://media.example/cam-b.mp4", kind: "video" }] }
    const { payload } = build({ edits: [JSON.stringify(twoCams)], data: { excludeSourceIds: ["camB", "gone"] } })
    expect(payload.excludeSourceIds).toEqual(["camB"])
    expect(build({ edl: EDL, data: { excludeSourceIds: ["camB"] } }).payload.excludeSourceIds).toEqual([])
  })

  it("a bare video alone still runs whole, with no untick list", () => {
    flag.priced = true
    const { payload } = build({ videoUrl: "https://media.example/v.mp4", data: { excludeSourceIds: ["camB"] } })
    expect(payload.videoUrl).toBe("https://media.example/v.mp4")
    expect(payload.excludeSourceIds).toBeUndefined()
    expect(payload.edl).toBeUndefined()
  })
})
