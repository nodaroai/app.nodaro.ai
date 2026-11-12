/**
 * The render re-measures the leading video it downloaded — the foreground for
 * the video fill, the background for pixelate / blur — and, BEFORE ffmpeg
 * runs, refuses one that needs more units than the run was charged, or a job
 * that carries none. The refusal is a DeterministicJobError: the worker fails
 * the row and refunds it on this attempt, with no retry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  downloadFile: vi.fn(async (_url: string, _path: string) => undefined),
  probeVideoOverlayBase: vi.fn(async (_path: string) => ({
    width: 640, height: 360, avgFrameRate: "30/1", rFrameRate: "30/1", streamDurationSec: 10, startTimeSec: 0, sar: 1,
  })),
  hasAudioStream: vi.fn(async (_path: string) => false),
  runFfmpeg: vi.fn(async (_argv: string[], _timeout: number, _opts?: unknown) => undefined),
  createWorkDir: vi.fn(async (_name: string) => "/tmp/mc-test"),
  cleanupWorkDir: vi.fn(async (_dir: string) => undefined),
}))

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: m.downloadFile,
  probeVideoOverlayBase: m.probeVideoOverlayBase,
  hasAudioStream: m.hasAudioStream,
  runFfmpeg: m.runFfmpeg,
  createWorkDir: m.createWorkDir,
  cleanupWorkDir: m.cleanupWorkDir,
}))

import { resolveMaskCompositeSettings } from "@nodaro/shared/media"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { maskComposite } from "../mask-composite.js"

const URLS = { foregroundUrl: "https://cdn.example/fg.mp4", backgroundUrl: "https://cdn.example/bg.mp4", maskUrl: "https://cdn.example/m.mp4" }
const leadAt = (sec: number) =>
  m.probeVideoOverlayBase.mockResolvedValue({ width: 640, height: 360, avgFrameRate: "30/1", rFrameRate: "30/1", streamDurationSec: sec, startTimeSec: 0, sar: 1 })

async function refusal(run: Promise<unknown>): Promise<Error> {
  const err = await run.then(() => undefined, (e: unknown) => e)
  if (!(err instanceof Error)) throw new Error("the render was not refused")
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  leadAt(10)
})

describe("maskComposite — the video fill re-measures the foreground", () => {
  const settings = resolveMaskCompositeSettings({})

  it("a foreground within the units charged (and the half-second slack) renders", async () => {
    for (const sec of [10, 10.4]) {
      leadAt(sec)
      await expect(maskComposite({ ...URLS, settings, billedUnits: 2 })).resolves.toMatchObject({ durationSec: sec })
    }
    expect(m.runFfmpeg).toHaveBeenCalledTimes(2)
  })

  it("a foreground that needs more units is refused before ffmpeg runs — deterministic, so refunded with no retry", async () => {
    leadAt(10.6)
    const err = await refusal(maskComposite({ ...URLS, settings, billedUnits: 2 }))
    expect(err.message).toBe("The foreground video is 11 seconds, longer than the 10 seconds this run was priced for — run it again")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.runFfmpeg).not.toHaveBeenCalled()
    expect(m.probeVideoOverlayBase).toHaveBeenCalledWith("/tmp/mc-test/foreground.mp4")
    expect(m.cleanupWorkDir).toHaveBeenCalledWith("/tmp/mc-test")
  })

  it("a job with no priced units is refused, never rendered", async () => {
    const err = await refusal(maskComposite({ ...URLS, settings }))
    expect(err.message).toBe("This run was not priced for its foreground video — run it again")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })

  it("a foreground over 300 s keeps its own refusal", async () => {
    leadAt(301)
    const err = await refusal(maskComposite({ ...URLS, settings, billedUnits: 60 }))
    expect(err.message).toMatch(/takes at most 300/)
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })
})

describe.each(["pixelate", "blur"] as const)("maskComposite — %s re-measures the background", (fill) => {
  const settings = resolveMaskCompositeSettings({ fill })

  it("a background within the units charged renders, and no foreground is downloaded", async () => {
    leadAt(41)
    await expect(maskComposite({ ...URLS, settings, billedUnits: 9 })).resolves.toMatchObject({ durationSec: 41 })
    expect(m.probeVideoOverlayBase).toHaveBeenCalledWith("/tmp/mc-test/background.mp4")
    expect(m.downloadFile).not.toHaveBeenCalledWith(URLS.foregroundUrl, expect.anything())
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("a background that needs more units is refused before ffmpeg runs", async () => {
    leadAt(41)
    const err = await refusal(maskComposite({ ...URLS, settings, billedUnits: 3 }))
    expect(err.message).toBe("The background video is 41 seconds, longer than the 15 seconds this run was priced for — run it again")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.runFfmpeg).not.toHaveBeenCalled()
    expect(m.cleanupWorkDir).toHaveBeenCalledWith("/tmp/mc-test")
  })

  it("a job with no priced units is refused", async () => {
    const err = await refusal(maskComposite({ ...URLS, settings }))
    expect(err.message).toBe("This run was not priced for its background video — run it again")
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })
})
