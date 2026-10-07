// The EDL timeline refuses an unknown `xfade:<id>` layout switch BEFORE it
// downloads a single source: the refusal is a pure function of the EDL, so
// finding it hours into a long render (or never, when the blend rounds under
// one frame and the join becomes a cut) is the wrong place. Only the source
// fetch is faked — the pre-flight must stop the render before it.
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Edl } from "@nodaro/shared"

const fx = vi.hoisted(() => ({ downloads: [] as string[] }))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string) => {
      fx.downloads.push(url)
      throw new Error("download reached")
    },
  }
})

import { renderEdlTimeline } from "../edl-timeline.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

const edl = {
  version: 1,
  clock: "master",
  sources: [
    { id: "A", url: "https://f.test/a.mp4", kind: "video" },
    { id: "B", url: "https://f.test/b.mp4", kind: "video" },
    { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" },
  ],
  segments: [
    { id: "s0", inMs: 0, outMs: 3000, video: "A" },
    // 10 ms at 30 fps rounds under one frame: the picture join would be a cut
    { id: "s1", inMs: 3000, outMs: 6000, video: "B", layout: { mode: "single", transition: { type: "xfade:warp-drive", durationMs: 10 } } },
  ],
} as unknown as Edl

beforeEach(() => {
  fx.downloads = []
})

describe("renderEdlTimeline — an unknown xfade: switch is refused before any download", () => {
  for (const output of ["video", "audio"] as const) {
    it(`${output} render`, async () => {
      let err: unknown
      try {
        await renderEdlTimeline({ edl, output, quality: "final", jobId: "job-preflight", checkpoint: false, label: "speaker-view" })
      } catch (e) {
        err = e
      }
      expect(isDeterministicJobError(err)).toBe(true)
      expect(String((err as Error).message)).toMatch(/s1.*xfade:warp-drive/)
      expect(fx.downloads).toEqual([])
    })
  }
})
