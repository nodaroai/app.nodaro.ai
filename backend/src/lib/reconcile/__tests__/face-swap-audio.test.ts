/**
 * A Face Swap finished by the reconcile lane keeps the source clip's sound, as
 * its worker's delivery does. Job e1ea988f (2026-11-22) was delivered silent:
 * its worker did not see the prediction finish, and the reconcile lane stored
 * the provider's picture-only result as it came back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkDir: vi.fn(async () => "/tmp/face-swap-audio-recovered-1"),
  cleanupWorkDir: vi.fn(async () => {}),
  swapWithSourceAudio: vi.fn(
    async (): Promise<{ path: string; hasSourceAudio: boolean } | undefined> => ({
      path: "/tmp/face-swap-audio-recovered-1/with-audio.mp4",
      hasSourceAudio: true,
    }),
  ),
  uploadJobScratchFile: vi.fn(async () => "https://r2.example/tmp/provider-input/j-fs/face-swap-audio-x.mp4"),
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))
vi.mock("../../../workers/handlers/face-swap-audio.js", () => ({ swapWithSourceAudio: mocks.swapWithSourceAudio }))
vi.mock("../../job-scratch.js", () => ({ uploadJobScratchFile: mocks.uploadJobScratchFile }))

import { recoveredFaceSwapWithAudio } from "../face-swap-audio.js"

const SWAP = "https://replicate.example/swap.mp4"
const SOURCE = "https://cdn.example/clip.mp4"
const row = (input_data: Record<string, unknown> | null = { videoUrl: SOURCE }, job_type = "face-swap") => ({
  id: "j-fs",
  job_type,
  input_data,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("recoveredFaceSwapWithAudio", () => {
  it("stores the swap with the source's sound in the job's scratch folder, for finalize to deliver", async () => {
    const url = await recoveredFaceSwapWithAudio(row(), SWAP)
    expect(mocks.swapWithSourceAudio).toHaveBeenCalledWith("/tmp/face-swap-audio-recovered-1", SWAP, SOURCE, "j-fs")
    expect(mocks.uploadJobScratchFile).toHaveBeenCalledWith(
      "/tmp/face-swap-audio-recovered-1/with-audio.mp4",
      "face-swap-audio",
      "mp4",
      "video/mp4",
      "j-fs",
    )
    expect(url).toBe("https://r2.example/tmp/provider-input/j-fs/face-swap-audio-x.mp4")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/face-swap-audio-recovered-1")
  })

  it("a source with no sound delivers the swap as it came back", async () => {
    mocks.swapWithSourceAudio.mockResolvedValueOnce({ path: "/tmp/face-swap-audio-recovered-1/swapped.mp4", hasSourceAudio: false })
    expect(await recoveredFaceSwapWithAudio(row(), SWAP)).toBeUndefined()
    expect(mocks.uploadJobScratchFile).not.toHaveBeenCalled()
  })

  it("a failed download or mux delivers the swap as it came back", async () => {
    mocks.swapWithSourceAudio.mockResolvedValueOnce(undefined)
    expect(await recoveredFaceSwapWithAudio(row(), SWAP)).toBeUndefined()
    expect(mocks.uploadJobScratchFile).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalled()
  })

  it("a failed scratch upload delivers the swap as it came back, never failing the recovered job", async () => {
    mocks.uploadJobScratchFile.mockRejectedValueOnce(new Error("R2 down"))
    expect(await recoveredFaceSwapWithAudio(row(), SWAP)).toBeUndefined()
    expect(mocks.cleanupWorkDir).toHaveBeenCalled()
  })

  it.each([
    ["no input on record", null],
    ["no source link", {}],
    ["a blank source link", { videoUrl: "  " }],
  ])("%s: the swap as it came back, nothing downloaded", async (_name, input) => {
    expect(await recoveredFaceSwapWithAudio(row(input), SWAP)).toBeUndefined()
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
  })

  it("another job type is left alone", async () => {
    expect(await recoveredFaceSwapWithAudio(row({ videoUrl: SOURCE }, "video-upscale"), SWAP)).toBeUndefined()
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
  })
})
