/**
 * Trim Audio (`trim-audio.ts`) given a social link is an import of a link:
 * the gate reads before anything is fetched or a work dir made; the
 * confirmation is spent right before yt-dlp runs; a gate refusal keeps its own
 * error. A direct file is not an import of a link and never asks the gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  youtubedl: vi.fn(),
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn(),
  createWorkDir: vi.fn(),
  cleanupWorkDir: vi.fn(),
  requireImportAllowed: vi.fn(),
  spendImportConfirmation: vi.fn(),
}))

vi.mock("youtube-dl-exec", () => ({ default: mocks.youtubedl }))
vi.mock("../ytdlp-admission.js", () => ({ withYtDlpOptionsAdmission: async (_o: unknown, run: () => Promise<unknown>) => run() }))
vi.mock("../yt-proxy.js", () => ({ ytProxyOption: () => ({}) }))
vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))
vi.mock("../../../lib/import-gate.js", () => ({
  requireImportAllowed: mocks.requireImportAllowed,
  spendImportConfirmation: mocks.spendImportConfirmation,
}))

import { join } from "node:path"
import { trimAudio } from "../trim-audio.js"

const SOCIAL = "https://www.youtube.com/watch?v=abc"
const DIRECT = "https://cdn.example.com/clip.mp4"
const rights = { userId: "u1", confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01", lane: "route" as const, requestId: "job-1" }

class Refusal extends Error {
  readonly code = "import_source_disabled"
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.createWorkDir.mockResolvedValue("/tmp/trim-work")
})

describe("trimAudio", () => {
  it("a refusal by the gate is the gate's own error, before any work dir or fetch", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Refusal("This link can't be imported here."))
    await expect(trimAudio({ videoUrl: SOCIAL }, rights)).rejects.toBeInstanceOf(Refusal)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, rights)
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(mocks.youtubedl).not.toHaveBeenCalled()
  })

  it("spends the confirmation right before yt-dlp runs; a spent one fetches nothing and keeps its error", async () => {
    mocks.youtubedl.mockRejectedValueOnce(new Error("yt-dlp failed"))
    await expect(trimAudio({ videoUrl: SOCIAL }, rights)).rejects.toThrow("yt-dlp download failed: yt-dlp failed")
    expect(mocks.spendImportConfirmation).toHaveBeenCalledWith(SOCIAL, rights)
    expect(mocks.spendImportConfirmation.mock.invocationCallOrder[0]).toBeLessThan(mocks.youtubedl.mock.invocationCallOrder[0]!)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/trim-work")

    mocks.spendImportConfirmation.mockRejectedValueOnce(new Refusal("Used already"))
    await expect(trimAudio({ videoUrl: SOCIAL }, rights)).rejects.toBeInstanceOf(Refusal)
    expect(mocks.youtubedl).toHaveBeenCalledTimes(1)
  })

  it("a direct file is not an import of a link: the gate is never asked", async () => {
    const out = await trimAudio({ videoUrl: DIRECT, startTime: 1, endTime: 2 }, rights)
    expect(out).toEqual({ audioPath: join("/tmp/trim-work", "output.mp3") })
    expect(mocks.downloadFile).toHaveBeenCalledWith(DIRECT, join("/tmp/trim-work", "input.mp4"))
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(mocks.youtubedl).not.toHaveBeenCalled()
  })
})
