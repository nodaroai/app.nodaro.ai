/**
 * Unit coverage for the download loop inside `assembleNarratedVideo` — the
 * production URL-based entry point. No network, no real ffmpeg: `downloadFile`
 * and `createWorkDir` are mocked (partial mock of ffmpeg-utils.js), so the
 * assemble/normalize/concat pipeline never runs.
 *
 * Regression target: the download loop (~lines 60-71) previously had no
 * per-block error wrapper, so a failed download (expired signed URL, network
 * timeout) surfaced un-prefixed instead of matching the design's
 * `Block N: <cause>` convention already applied to the processing loop in
 * `assembleNarratedVideoFromLocalFiles`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { assembleNarratedVideo } from "../assemble-narrated-video.js"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return { ...actual, downloadFile: vi.fn(), createWorkDir: vi.fn() }
})

import { downloadFile, createWorkDir } from "../ffmpeg-utils.js"

describe("assembleNarratedVideo — download loop Block-N error prefixing", () => {
  beforeEach(() => {
    vi.mocked(createWorkDir).mockResolvedValue("/tmp/anv-unit-fake-workdir")
    vi.mocked(downloadFile).mockReset()
  })

  it("rejects with 'Block 2: boom' (not bare 'boom') when block 2's video download fails, preserving cause", async () => {
    vi.mocked(downloadFile).mockImplementation(async (url: string) => {
      if (url === "https://a/2.mp4") throw new Error("boom")
      return undefined
    })

    const promise = assembleNarratedVideo({
      blocks: [
        { videoUrl: "https://a/1.mp4" },
        { videoUrl: "https://a/2.mp4" },
      ],
    })

    await expect(promise).rejects.toThrow("Block 2: boom")

    let caught: unknown
    try {
      await assembleNarratedVideo({
        blocks: [
          { videoUrl: "https://a/1.mp4" },
          { videoUrl: "https://a/2.mp4" },
        ],
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe("Block 2: boom")
    expect((caught as Error).cause).toBeInstanceOf(Error)
    expect(((caught as Error).cause as Error).message).toBe("boom")
  })
})
