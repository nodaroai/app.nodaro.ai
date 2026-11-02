/**
 * The audio extractor (`youtube-extractor.ts`) is an import of a link: the
 * gate reads first and nothing is fetched on a refusal; the confirmation is
 * spent right before yt-dlp runs; a gate refusal keeps its own error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  spawnYtDlpDownload: vi.fn(),
  runThroughClientLadder: vi.fn(),
  requireImportAllowed: vi.fn(),
  spendImportConfirmation: vi.fn(),
}))

vi.mock("../../video/youtube-video.js", () => ({
  runThroughClientLadder: mocks.runThroughClientLadder,
  spawnYtDlpDownload: mocks.spawnYtDlpDownload,
  YT_SPOOF_ARGS: [],
  YtUrlNotAllowedError: class YtUrlNotAllowedError extends Error {},
}))
vi.mock("../../video/yt-proxy.js", () => ({ resolveAttemptChain: () => [null] }))
vi.mock("../../video/ffmpeg-utils.js", () => ({ probeMediaDuration: vi.fn() }))
vi.mock("../../../lib/storage.js", () => ({ uploadFileToR2: vi.fn() }))
vi.mock("../../../lib/import-gate.js", () => ({
  requireImportAllowed: mocks.requireImportAllowed,
  spendImportConfirmation: mocks.spendImportConfirmation,
}))

import { extractYouTubeAudio, extractYouTubeAudioWithMeta } from "../youtube-extractor.js"

const URL_ = "https://www.youtube.com/watch?v=abc"
const rights = { userId: "u1", confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01", lane: "route" as const }

class Refusal extends Error {
  readonly code = "import_source_disabled"
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  mocks.runThroughClientLadder.mockImplementation(async (_url: string, run: (rung: { extractorArgs: string[] }) => Promise<void>) => run({ extractorArgs: [] }))
})

describe("extractYouTubeAudioWithMeta", () => {
  it("a refusal by the gate is the gate's own error, before any fetch", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Refusal("This link can't be imported here."))
    await expect(extractYouTubeAudio(URL_, rights)).rejects.toBeInstanceOf(Refusal)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(URL_, rights)
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(mocks.spawnYtDlpDownload).not.toHaveBeenCalled()
  })

  it("spends the confirmation right before yt-dlp runs; a spent one fetches nothing", async () => {
    mocks.spawnYtDlpDownload.mockRejectedValueOnce(new Error("yt-dlp failed"))
    await expect(extractYouTubeAudioWithMeta(URL_, rights)).rejects.toThrow("yt-dlp failed")
    expect(mocks.spendImportConfirmation).toHaveBeenCalledWith(URL_, rights)
    expect(mocks.spendImportConfirmation.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawnYtDlpDownload.mock.invocationCallOrder[0]!)

    mocks.spendImportConfirmation.mockRejectedValueOnce(new Refusal("Used already"))
    await expect(extractYouTubeAudioWithMeta(URL_, rights)).rejects.toBeInstanceOf(Refusal)
    expect(mocks.spawnYtDlpDownload).toHaveBeenCalledTimes(1)
  })

  it("a host outside the allowlist is refused before the gate is asked", async () => {
    await expect(extractYouTubeAudio("https://example.com/v", rights)).rejects.toThrow("host not allowed")
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
  })
})
