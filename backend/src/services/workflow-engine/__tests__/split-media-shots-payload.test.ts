/**
 * Split into Chunks in a server-run workflow (payload-builder): shots mode sends
 * the video and the mode and no part length; the part-length split's job is
 * exactly what it was.
 */
import { describe, expect, it } from "vitest"
import { buildPayload } from "../payload-builder.js"

const run = (data: Record<string, unknown>, inputs: Record<string, unknown> = { videoUrl: "https://cdn.example/v.mp4" }) =>
  buildPayload({ id: "split", type: "split-media", data: { label: "Split", ...data } } as never, "job-1", inputs as never, "u-1")

describe("split-media payload", () => {
  it("shots mode: the video and mode \"shots\", no part length, minimum or audio format", () => {
    const r = run({ mode: "shots", chunkDuration: 30, minPartDuration: 2, audioFormat: "wav" })
    expect(r.payload).toEqual({ jobId: "job-1", videoUrl: "https://cdn.example/v.mp4", mode: "shots", usageLogId: "u-1" })
    expect(r.modelIdentifier).toBe("split-media")
  })

  it("shots mode refuses a wired audio, and an audio with no video, before anything is reserved", () => {
    expect(() => run({ mode: "shots" }, { videoUrl: "https://cdn.example/v.mp4", audioUrl: "https://cdn.example/a.mp3" })).toThrow(/disconnect the audio input/)
    expect(() => run({ mode: "shots" }, { audioUrl: "https://cdn.example/a.mp3" })).toThrow(/needs a video/)
  })

  it("without the mode, the part-length job is unchanged (the default 10 s part)", () => {
    expect(run({}).payload).toEqual({ jobId: "job-1", videoUrl: "https://cdn.example/v.mp4", audioUrl: undefined, chunkDuration: 10, minPartDuration: undefined, audioFormat: undefined, usageLogId: "u-1" })
    expect(run({ mode: "duration", chunkDuration: 30, minPartDuration: 5, audioFormat: "aac" }).payload).toEqual({
      jobId: "job-1", videoUrl: "https://cdn.example/v.mp4", audioUrl: undefined, chunkDuration: 30, minPartDuration: 5, audioFormat: "aac", usageLogId: "u-1",
    })
  })
})
