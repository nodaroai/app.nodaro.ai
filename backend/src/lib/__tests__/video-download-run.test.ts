import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as fs } from "node:fs"

vi.mock("@/providers/video/youtube-video.js", () => ({ downloadYouTubeVideo: vi.fn() }))
vi.mock("@/lib/storage.js", () => ({
  uploadFileWithKeyToR2: vi.fn().mockResolvedValue("https://pub-test.r2.dev/videos/yt-x.mp4"),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://pub-test.r2.dev/thumbnails/yt-x.png"),
}))
vi.mock("@/lib/asset-records.js", () => ({ recordDownloadedVideoAsset: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/utils/thumbnail.js", () => ({ thumbnailFromLocalVideo: vi.fn().mockResolvedValue(Buffer.from("png")) }))

import {
  MAX_ACTIVE_DOWNLOADS_PER_USER,
  RunDownloadError,
  activeDownloads,
  downloadVideoForRun,
  runningDownloadsFor,
  tryAcquireDownloadSlot,
  withDownloadSlot,
} from "../video-download.js"
import { DownloadSlots } from "../download-slots.js"
import { setDownloadSlotsForTests } from "../download-slots-instance.js"
import { RedisDownloadLedger } from "../download-slot-ledger.js"
import { makeFakeDownloadClient, makeFakeDownloadStore } from "./fake-download-redis.js"
import { downloadYouTubeVideo } from "../../providers/video/youtube-video.js"
import { recordDownloadedVideoAsset } from "../asset-records.js"

const URL_ = "https://www.tiktok.com/@someone/video/7676964064458738952"

/** A provider whose downloads finish when the test lets them. */
function gatedProvider() {
  const gates: Array<() => void> = []
  vi.mocked(downloadYouTubeVideo).mockImplementation(async (opts) => {
    await new Promise<void>((resolve) => gates.push(resolve))
    await fs.writeFile(opts.outPath, "fake-video")
  })
  return { release: () => gates.splice(0).forEach((g) => g()), pending: () => gates.length }
}

beforeEach(() => {
  vi.clearAllMocks()
  setDownloadSlotsForTests(undefined)
  activeDownloads.clear()
  vi.mocked(downloadYouTubeVideo).mockImplementation(async (opts) => {
    await fs.writeFile(opts.outPath, "fake-video")
  })
})

describe("a run's download goes through the route's downloader", () => {
  it("resolves with the stored file, recorded under the run's account", async () => {
    const file = await downloadVideoForRun({ url: URL_, userId: "u1", maxHeight: 1080 })
    expect(file.videoUrl).toBe("https://pub-test.r2.dev/videos/yt-x.mp4")
    expect(downloadYouTubeVideo).toHaveBeenCalledWith(expect.objectContaining({ url: URL_, maxHeight: 1080, requireAudio: true }))
    expect(recordDownloadedVideoAsset).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", sourceUrl: URL_ }))
  })

  it("passes an exact part straight to the provider", async () => {
    await downloadVideoForRun({ url: URL_, userId: "u1", section: { startSec: 600, endSec: 1200, exact: true } })
    expect(downloadYouTubeVideo).toHaveBeenCalledWith(expect.objectContaining({ section: { startSec: 600, endSec: 1200, exact: true } }))
  })

  it("a provider failure is a `failed` error carrying the provider's message", async () => {
    vi.mocked(downloadYouTubeVideo).mockRejectedValue(new Error("Video unavailable: this video is private"))
    await expect(downloadVideoForRun({ url: URL_, userId: "u1" })).rejects.toMatchObject({
      name: "RunDownloadError",
      kind: "failed",
      message: "Video unavailable: this video is private",
    })
  })
})

describe("the account's cap on running downloads is the run's too", () => {
  it("a run's download occupies a slot while it runs and frees it when it ends", async () => {
    const provider = gatedProvider()
    const pending = downloadVideoForRun({ url: URL_, userId: "u1" })
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(1))
    provider.release()
    await pending
    expect(runningDownloadsFor("u1")).toBe(0)
    expect(runningDownloadsFor("someone-else")).toBe(0)
  })

  it("waits for a slot when the account already has its maximum running, then goes", async () => {
    const provider = gatedProvider()
    const first = Array.from({ length: MAX_ACTIVE_DOWNLOADS_PER_USER }, () => downloadVideoForRun({ url: URL_, userId: "u1" }))
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(MAX_ACTIVE_DOWNLOADS_PER_USER))

    const extra = downloadVideoForRun({ url: URL_, userId: "u1", slotWaitMs: 60_000 })
    await new Promise((r) => setTimeout(r, 30))
    expect(downloadYouTubeVideo).toHaveBeenCalledTimes(MAX_ACTIVE_DOWNLOADS_PER_USER)

    provider.release() // one finishing frees the next
    await Promise.all(first)
    await vi.waitFor(() => expect(provider.pending()).toBeGreaterThan(0), { timeout: 3000 })
    provider.release()
    await expect(extra).resolves.toMatchObject({ videoUrl: expect.any(String) })
  })

  it("gives up with the route's own `too many downloads` words when no slot frees in time", async () => {
    gatedProvider()
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER; i++) void downloadVideoForRun({ url: URL_, userId: "u1" })
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(MAX_ACTIVE_DOWNLOADS_PER_USER))
    await expect(downloadVideoForRun({ url: URL_, userId: "u1", slotWaitMs: 20 })).rejects.toMatchObject({
      kind: "busy",
      message: expect.stringMatching(/Too many downloads/),
    })
  })

  it("a stop of the run ends the wait; the download itself carries on and frees its slot when it ends", async () => {
    const provider = gatedProvider()
    const controller = new AbortController()
    const pending = downloadVideoForRun({ url: URL_, userId: "u1", signal: controller.signal })
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: "aborted" })
    expect(runningDownloadsFor("u1")).toBe(1)
    provider.release()
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(0))
  })

  it("a download past its ceiling stops the run's wait with a `timeout`", async () => {
    gatedProvider()
    await expect(downloadVideoForRun({ url: URL_, userId: "u1", maxMs: 20 })).rejects.toBeInstanceOf(RunDownloadError)
  })
})

describe("withDownloadSlot — the sound's fetch counts against the same cap", () => {
  it("holds a slot for the length of the work, and frees it on success and on failure", async () => {
    let release!: () => void
    const work = new Promise<string>((resolve) => (release = () => resolve("audio-url")))
    const pending = withDownloadSlot("u1", () => work)
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(1))
    release()
    await expect(pending).resolves.toBe("audio-url")
    expect(runningDownloadsFor("u1")).toBe(0)

    await expect(withDownloadSlot("u1", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom")
    expect(runningDownloadsFor("u1")).toBe(0)
  })
})

describe("the cap is ONE count across processes (decided 2026-10-08)", () => {
  /** This process, and "the other process" (the API process, where the card's downloads run) on one ledger. */
  function twoProcesses() {
    const client = makeFakeDownloadClient(makeFakeDownloadStore())
    const ledger = new RedisDownloadLedger({ client: () => client, commandTimeoutMs: 50 })
    const make = () => new DownloadSlots({ ledger: async () => ledger, log: () => undefined })
    const mine = make()
    setDownloadSlotsForTests(mine)
    return { client, other: make() }
  }

  it("a run waits while the account's slots are taken in ANOTHER process, and starts when one frees", async () => {
    const { other } = twoProcesses()
    const taken = []
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER; i++) taken.push(await other.tryAcquire("u1", MAX_ACTIVE_DOWNLOADS_PER_USER))

    const run = downloadVideoForRun({ url: URL_, userId: "u1", slotWaitMs: 60_000 })
    await new Promise((r) => setTimeout(r, 50))
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()

    taken[0]!.release()
    await expect(run).resolves.toMatchObject({ videoUrl: expect.any(String) })
    expect(downloadYouTubeVideo).toHaveBeenCalledTimes(1)
  })

  it("gives up with the route's own words when the other process keeps its slots", async () => {
    const { other } = twoProcesses()
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER; i++) await other.tryAcquire("u1", MAX_ACTIVE_DOWNLOADS_PER_USER)
    await expect(downloadVideoForRun({ url: URL_, userId: "u1", slotWaitMs: 20 })).rejects.toMatchObject({ kind: "busy" })
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("the sound's fetch takes a slot in the same count", async () => {
    const { other } = twoProcesses()
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER; i++) await other.tryAcquire("u1", MAX_ACTIVE_DOWNLOADS_PER_USER)
    const work = vi.fn().mockResolvedValue("audio-url")
    await expect(withDownloadSlot("u1", work, { slotWaitMs: 20 })).rejects.toMatchObject({ kind: "busy" })
    expect(work).not.toHaveBeenCalled()
  })

  it("a run's download and a card's download (the route takes its slot with tryAcquireDownloadSlot) count against each other", async () => {
    twoProcesses()
    const gated = gatedProvider()
    const card = []
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER - 1; i++) card.push(await tryAcquireDownloadSlot("u1"))
    expect(card.every((s) => s !== null)).toBe(true)

    const run = downloadVideoForRun({ url: URL_, userId: "u1" }) // the last slot
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(1))
    expect(await tryAcquireDownloadSlot("u1")).toBeNull() // the route would answer 429
    gated.release()
    await run
    expect(await tryAcquireDownloadSlot("u1")).not.toBeNull()
  })

  it("a download's slot is released when it ends, whether it succeeds or fails", async () => {
    const { other } = twoProcesses()
    await downloadVideoForRun({ url: URL_, userId: "u1" })
    vi.mocked(downloadYouTubeVideo).mockRejectedValue(new Error("private"))
    await expect(downloadVideoForRun({ url: URL_, userId: "u1" })).rejects.toMatchObject({ kind: "failed" })
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER; i++) {
      await vi.waitFor(async () => expect(await other.tryAcquire("u1", MAX_ACTIVE_DOWNLOADS_PER_USER)).not.toBeNull())
    }
  })

  it("a stop of the run while it waits for a slot leaves no slot taken (a slot granted after the stop is given back)", async () => {
    const { other } = twoProcesses()
    const controller = new AbortController()
    const pending = downloadVideoForRun({ url: URL_, userId: "u1", signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: "aborted" })
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER; i++) {
      await vi.waitFor(async () => expect(await other.tryAcquire("u1", MAX_ACTIVE_DOWNLOADS_PER_USER)).not.toBeNull())
    }
  })

  it("with Redis down the run still honours the cap, counted in its own process", async () => {
    const { client } = twoProcesses()
    client.down = true
    gatedProvider()
    for (let i = 0; i < MAX_ACTIVE_DOWNLOADS_PER_USER; i++) void downloadVideoForRun({ url: URL_, userId: "u1" })
    await vi.waitFor(() => expect(runningDownloadsFor("u1")).toBe(MAX_ACTIVE_DOWNLOADS_PER_USER))
    await expect(downloadVideoForRun({ url: URL_, userId: "u1", slotWaitMs: 20 })).rejects.toMatchObject({ kind: "busy" })
  })
})
