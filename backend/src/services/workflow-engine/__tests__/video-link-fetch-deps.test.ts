/**
 * The real downloader a run's Video URL fetch binds (`video-link-fetch-deps.ts`):
 * the confirmation and request id the fetch was handed reach the engines as the
 * rights every import lane carries, and the audio lane reads the gate before
 * it waits for a slot.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/providers/video/youtube-video.js", () => ({ ytMetadataProbe: vi.fn() }))
vi.mock("@/lib/video-download.js", () => ({
  downloadVideoForRun: vi.fn().mockResolvedValue({ videoUrl: "https://cdn.test/v.mp4" }),
  withDownloadSlot: vi.fn(async (_userId: string, work: () => Promise<unknown>) => work()),
}))
vi.mock("@/workers/download-audio.js", () => ({ downloadAudioToR2: vi.fn().mockResolvedValue("https://cdn.test/a.mp3") }))
vi.mock("@/lib/import-gate.js", () => ({ requireImportAllowed: vi.fn().mockResolvedValue(undefined) }))

import { realVideoLinkFetchDeps } from "../video-link-fetch-deps.js"
import { ytMetadataProbe } from "../../../providers/video/youtube-video.js"
import { downloadVideoForRun, withDownloadSlot } from "../../../lib/video-download.js"
import { downloadAudioToR2 } from "../../../workers/download-audio.js"
import { requireImportAllowed } from "../../../lib/import-gate.js"

const URL_ = "https://www.tiktok.com/@someone/video/7676964064458738952"
const CONFIRMATION = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the run's real video-link downloader", () => {
  it("downloads the video through the route's engine under the fetch's confirmation and request id", async () => {
    const file = await realVideoLinkFetchDeps.downloadVideo({ url: URL_, userId: "u1", maxHeight: 1080, confirmationId: CONFIRMATION, requestId: "exec-1:src" })
    expect(file).toEqual({ videoUrl: "https://cdn.test/v.mp4" })
    expect(downloadVideoForRun).toHaveBeenCalledWith(
      expect.objectContaining({ url: URL_, userId: "u1", maxHeight: 1080, rightsConfirmationId: CONFIRMATION, requestId: "exec-1:src" }),
    )
  })

  it("with no confirmation the engine is told so (null), never handed an empty string", async () => {
    await realVideoLinkFetchDeps.downloadVideo({ url: URL_, userId: "u1" })
    expect(downloadVideoForRun).toHaveBeenCalledWith(expect.objectContaining({ rightsConfirmationId: null, requestId: null }))
  })

  it("the sound: the gate is read before the slot wait, then the worker's engine runs under the same rights in the slot", async () => {
    const order: string[] = []
    vi.mocked(requireImportAllowed).mockImplementation(async () => {
      order.push("gate")
    })
    vi.mocked(withDownloadSlot).mockImplementation(async (_userId, work) => {
      order.push("slot")
      return work()
    })
    const track = await realVideoLinkFetchDeps.downloadAudio(URL_, { userId: "u1", confirmationId: CONFIRMATION, requestId: "exec-1:src" })
    expect(track).toBe("https://cdn.test/a.mp3")
    const rights = { userId: "u1", confirmationId: CONFIRMATION, lane: "run", requestId: "exec-1:src", via: null }
    expect(requireImportAllowed).toHaveBeenCalledWith(URL_, rights)
    expect(downloadAudioToR2).toHaveBeenCalledWith(URL_, rights)
    expect(order).toEqual(["gate", "slot"])
  })

  it("the way the run was started reaches both engines as the rights' way in", async () => {
    await realVideoLinkFetchDeps.downloadVideo({ url: URL_, userId: "u1", via: "mcp" })
    expect(downloadVideoForRun).toHaveBeenCalledWith(expect.objectContaining({ importVia: "mcp" }))
    await realVideoLinkFetchDeps.downloadAudio(URL_, { userId: "u1", via: "api" })
    expect(requireImportAllowed).toHaveBeenCalledWith(URL_, expect.objectContaining({ via: "api" }))
    expect(downloadAudioToR2).toHaveBeenCalledWith(URL_, expect.objectContaining({ via: "api" }))
  })

  it("a refused sound import never reaches the slot", async () => {
    vi.mocked(requireImportAllowed).mockRejectedValueOnce(new Error("refused"))
    await expect(realVideoLinkFetchDeps.downloadAudio(URL_, { userId: "u1" })).rejects.toThrow("refused")
    expect(withDownloadSlot).not.toHaveBeenCalled()
    expect(downloadAudioToR2).not.toHaveBeenCalled()
  })

  it("a probe that fails answers unknown, never throws", async () => {
    vi.mocked(ytMetadataProbe).mockRejectedValueOnce(new Error("boom"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(await realVideoLinkFetchDeps.probe(URL_)).toEqual({ durationSec: null, title: null, isLive: false })
    warn.mockRestore()
  })
})
