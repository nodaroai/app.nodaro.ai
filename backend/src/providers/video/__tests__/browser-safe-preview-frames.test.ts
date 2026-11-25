// @test-reads-none ffprobe is mocked
/**
 * The frame count's three answers (decided 2026-11-23): only ffprobe RUNNING
 * and answering "no frame decodes" may condemn a delivered video; a check the
 * machine could not run is "could not tell", and the store retries it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ answer: [] as Array<string | Error> }))
vi.mock("../ffmpeg-utils.js", async (orig) => ({
  ...(await orig<object>()),
  runFfprobe: vi.fn(async () => {
    const next = m.answer.shift()
    if (next instanceof Error) throw next
    return next ?? ""
  }),
}))

import { decodedVideoFrames, pictureDecodes } from "../browser-safe-preview.js"

const failure = (message: string, flags: Record<string, unknown>) => Object.assign(new Error(message), flags)
const PROBE = { videoCodec: "hevc", pixFmt: "yuv420p10le", width: 320, height: 240 }

beforeEach(() => {
  m.answer.length = 0
})

describe("decodedVideoFrames", () => {
  it("frames decoded", async () => {
    m.answer.push("5\n")
    expect(await decodedVideoFrames("/f.mp4")).toEqual({ kind: "frames", n: 5 })
  })

  it("none: a clean exit with no frame, or ffprobe's own invalid-data refusal", async () => {
    m.answer.push("N/A\n")
    expect(await decodedVideoFrames("/f.mp4")).toEqual({ kind: "none" })
    m.answer.push(failure("ffprobe failed: Invalid data found when processing input", { killed: false, timedOut: false }))
    expect(await decodedVideoFrames("/f.mp4")).toEqual({ kind: "none" })
  })

  it.each([
    ["a spawn that never started (EAGAIN / ENOMEM)", { killed: false, timedOut: false, notStarted: true }, "spawn EAGAIN"],
    ["its own time limit", { killed: true, timedOut: true }, "ffprobe failed: timed out"],
    ["a kill from outside (out of memory)", { killed: false, timedOut: false, signalledFromOutside: true }, "ffprobe failed"],
    ["a log that outgrew its buffer", { killed: true, timedOut: false, truncated: true }, "ffprobe failed"],
    ["a machine short of threads", { killed: false, timedOut: false }, "ffprobe failed: pthread_create failed: Resource temporarily unavailable"],
  ])("could not tell: %s", async (_label, flags, message) => {
    m.answer.push(failure(message, flags))
    expect((await decodedVideoFrames("/f.mp4")).kind).toBe("unknown")
  })
})

describe("pictureDecodes", () => {
  it("yes, no, or could not tell — never 'no' for a check that did not run", async () => {
    m.answer.push("5\n")
    expect(await pictureDecodes("/f.mp4", PROBE)).toBe("yes")
    m.answer.push("N/A\n")
    expect(await pictureDecodes("/f.mp4", PROBE)).toBe("no")
    m.answer.push(failure("spawn EAGAIN", { killed: false, timedOut: false, notStarted: true }))
    expect(await pictureDecodes("/f.mp4", PROBE)).toMatchObject({ unknown: expect.anything() })
  })

  it("a short clip: every frame it holds, counted from its packets", async () => {
    m.answer.push("3\n", "3\n")
    expect(await pictureDecodes("/f.webm", PROBE)).toBe("yes")
    m.answer.push("2\n", "3\n")
    expect(await pictureDecodes("/f.webm", PROBE)).toBe("no")
    m.answer.push("2\n", failure("spawn EAGAIN", { killed: false, notStarted: true }))
    expect(await pictureDecodes("/f.webm", PROBE)).toMatchObject({ unknown: expect.anything() })
  })
})
