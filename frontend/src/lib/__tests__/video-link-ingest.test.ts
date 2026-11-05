import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TRANSIENT_RUNTIME_KEYS } from "@nodaro/shared/workflow"
import { VIDEO_LINK_DERIVED_FIELDS } from "@nodaro/shared/video"

// ---------------------------------------------------------------------------
// A tiny stand-in for the workflow store: the controller only reads `nodes` /
// `isReadOnly` and writes through `updateNodeData`.
// ---------------------------------------------------------------------------

interface FakeNode { id: string; type: string; data: Record<string, unknown> }
const undo = { skipping: false }
const store = {
  nodes: [] as FakeNode[],
  isReadOnly: false,
  patches: [] as Array<{ id: string; patch: Record<string, unknown>; undoable: boolean }>,
  updateNodeData(id: string, patch: Record<string, unknown>) {
    if (store.isReadOnly) return
    store.patches.push({ id, patch, undoable: !undo.skipping })
    store.nodes = store.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  },
}

type WorkflowListener = (state: { workflowId?: unknown }, previous: { workflowId?: unknown }) => void
const { workflowListeners } = vi.hoisted(() => ({ workflowListeners: [] as WorkflowListener[] }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
    getState: () => store,
    subscribe: (listener: WorkflowListener) => {
      workflowListeners.push(listener)
      return () => undefined
    },
  }),
}))

vi.mock("@/hooks/undo-flags", () => ({
  setSkipUndoCapture: (value: boolean) => { undo.skipping = value },
}))

const startVideoDownload = vi.fn()
const fetchVideoMetadata = vi.fn()
const fetchYouTubeOEmbed = vi.fn()
const downloadYouTubeAudio = vi.fn()
vi.mock("@/lib/api", () => ({
  startVideoDownload: (...a: unknown[]) => startVideoDownload(...a),
  fetchVideoMetadata: (...a: unknown[]) => fetchVideoMetadata(...a),
  fetchYouTubeOEmbed: (...a: unknown[]) => fetchYouTubeOEmbed(...a),
  downloadYouTubeAudio: (...a: unknown[]) => downloadYouTubeAudio(...a),
}))

const followVideoDownload = vi.fn()
vi.mock("@/lib/video-download-stream", () => ({
  followVideoDownload: (...a: unknown[]) => followVideoDownload(...a),
}))

// The content rights declaration (`lib/content-rights.ts`): a confirmation per download.
const { confirmLink, DeclarationChangedError } = vi.hoisted(() => ({
  confirmLink: vi.fn(),
  DeclarationChangedError: class DeclarationChangedError extends Error {},
}))
vi.mock("@/lib/content-rights", () => ({
  confirmLink: (...a: unknown[]) => confirmLink(...a),
  DeclarationChangedError,
}))

import {
  CLEARED_DOWNLOAD,
  __resetVideoLinkIngestForTests,
  clearVideoLink,
  confirmVideoLink,
  ensureVideoLinkAudio,
  ensureVideoLinksDownloaded,
  ENSURE_CONCURRENCY,
  findUnconfirmedVideoLink,
  ingestVideoLink,
  isVideoLinkConfirmed,
  isVideoLinkIngestLive,
  resumeVideoLinkIngest,
  retryVideoLinkIngest,
  setVideoLinkConfirmed,
  setVideoLinkUrl,
  VIDEO_LINK_INGEST_DEBOUNCE_MS,
} from "../video-link-ingest"
import { isNodeLinkRightsTicked, tickNodeLinkRights } from "../node-link-rights"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const TIKTOK = "https://www.tiktok.com/@someone/video/7676964064458738952"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"
const THUMB = "https://cdn.nodaro.ai/thumbnails/yt-1.jpg"
const CONFIRMED = { confirmationId: "conf-1" }

/** A node, with the content rights box ticked for its link unless said otherwise (rule 4). */
function seed(data: Record<string, unknown> = {}, id = "n1", options: { readonly ticked?: boolean } = {}) {
  store.nodes = [...store.nodes.filter((n) => n.id !== id), { id, type: "youtube-video", data: { label: "Video URL", ...data } }]
  if (options.ticked !== false) setVideoLinkConfirmed(id, true)
}
const dataOf = (id = "n1") => store.nodes.find((n) => n.id === id)!.data

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const LONG = { durationSec: 5530, title: "A long talk", isLive: false }

beforeEach(() => {
  vi.clearAllMocks()
  __resetVideoLinkIngestForTests()
  store.nodes = []
  store.patches = []
  store.isReadOnly = false
  undo.skipping = false
  startVideoDownload.mockResolvedValue({ downloadId: "dl-1" })
  followVideoDownload.mockResolvedValue({ status: "completed", videoUrl: FILE, thumbnailUrl: THUMB })
  fetchVideoMetadata.mockResolvedValue({ durationSec: 95, title: "A short clip", isLive: false })
  fetchYouTubeOEmbed.mockResolvedValue({ title: "A short clip", thumbnail_url: "https://i.ytimg.com/x.jpg" })
  downloadYouTubeAudio.mockResolvedValue({ url: "https://cdn.nodaro.ai/audios/a.mp3", thumbnailUrl: null })
  confirmLink.mockResolvedValue({ id: "conf-1", declarationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ingestVideoLink — what gets downloaded", () => {
  it("downloads a TikTok link whole, with no quality cap, and binds the file to the link", async () => {
    seed({ youtubeUrl: TIKTOK })
    const outcome = await ingestVideoLink("n1")
    expect(outcome).toEqual({ status: "completed", videoUrl: FILE })
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).toHaveBeenCalledWith(TIKTOK, CONFIRMED)
    expect(dataOf()).toMatchObject({
      downloadStatus: "completed",
      downloadedVideoUrl: FILE,
      downloadedThumbnailUrl: THUMB,
      downloadedFromUrl: TIKTOK,
      thumbnailUrl: THUMB,
      downloadId: "",
      downloadIdUrl: "",
    })
  })

  it("probes a YouTube link first and downloads a SHORT one whole, capped at 1080 rows", async () => {
    seed({ youtubeUrl: YT })
    const outcome = await ingestVideoLink("n1")
    expect(outcome.status).toBe("completed")
    expect(fetchVideoMetadata).toHaveBeenCalledWith(YT)
    expect(startVideoDownload).toHaveBeenCalledWith(YT, { maxHeight: 1080, ...CONFIRMED })
    expect(dataOf()).toMatchObject({ videoDurationSec: 95, downloadedFromUrl: YT })
  })

  it("does NOT download a long YouTube video on its own — it asks", async () => {
    fetchVideoMetadata.mockResolvedValue(LONG)
    seed({ youtubeUrl: YT })
    expect(await ingestVideoLink("n1")).toEqual({ status: "needs-choice", durationSec: 5530 })
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(dataOf()).toMatchObject({ downloadStatus: "idle", needsRangeChoice: true, videoDurationSec: 5530 })
  })

  it("draws the line AT four minutes — 3:59 downloads, 4:00 asks", async () => {
    fetchVideoMetadata.mockResolvedValue({ durationSec: 239.9, title: null, isLive: false })
    seed({ youtubeUrl: YT }, "short")
    expect((await ingestVideoLink("short")).status).toBe("completed")

    fetchVideoMetadata.mockResolvedValue({ durationSec: 240, title: null, isLive: false })
    seed({ youtubeUrl: YT }, "long")
    expect(await ingestVideoLink("long")).toEqual({ status: "needs-choice", durationSec: 240 })
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
  })

  it("asks as well when the length could not be read — an unknown length is not a short one", async () => {
    fetchVideoMetadata.mockResolvedValue({ durationSec: null, title: null, isLive: false })
    seed({ youtubeUrl: YT })
    expect(await ingestVideoLink("n1")).toEqual({ status: "needs-choice", durationSec: null })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("fails a live stream at once, before any download", async () => {
    fetchVideoMetadata.mockResolvedValue({ durationSec: null, title: "Live now", isLive: true })
    seed({ youtubeUrl: YT })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "live" })
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(dataOf()).toMatchObject({ downloadStatus: "failed", downloadErrorCode: "live" })
  })

  it("downloads the chosen part — no probe, the person already decided", async () => {
    seed({ youtubeUrl: YT, needsRangeChoice: true, videoDurationSec: 5530 })
    const outcome = await ingestVideoLink("n1", { mode: "section", section: { startSec: 30, endSec: 95 } })
    expect(outcome.status).toBe("completed")
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    // Exact: the part as chosen, never the server's padded fetch.
    expect(startVideoDownload).toHaveBeenCalledWith(YT, {
      maxHeight: 1080,
      section: { startSec: 30, endSec: 95 },
      exactSection: true,
      ...CONFIRMED,
    })
    expect(dataOf()).toMatchObject({
      needsRangeChoice: false,
      downloadMode: "section",
      sectionStartSec: 30,
      sectionEndSec: 95,
      downloadedSection: { startSec: 30, endSec: 95 },
    })
  })

  it("downloads a long video whole when told to", async () => {
    seed({ youtubeUrl: YT, needsRangeChoice: true })
    await ingestVideoLink("n1", { mode: "whole" })
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).toHaveBeenCalledWith(YT, { maxHeight: 1080, ...CONFIRMED })
    expect(dataOf()).toMatchObject({ downloadMode: "whole", downloadedSection: null })
  })

  it("skips a direct file link, an empty node and a node that already holds its file — without touching the network", async () => {
    seed({ youtubeUrl: FILE }, "a")
    seed({ youtubeUrl: "" }, "b")
    seed({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT }, "c")
    for (const id of ["a", "b", "c", "missing"]) {
      expect(await ingestVideoLink(id)).toEqual({ status: "skipped" })
    }
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("re-downloads over an existing file when forced — 'get a different part'", async () => {
    seed({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT })
    await ingestVideoLink("n1", { mode: "section", section: { startSec: 0, endSec: 10 }, force: true })
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
  })

  it("does nothing on a read-only canvas — a download nobody can keep is pure waste", async () => {
    store.isReadOnly = true
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "skipped" })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("stops — instead of pretending to write — when the canvas turns read-only mid-download", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValue(follow.promise)
    seed({ youtubeUrl: TIKTOK })
    const pending = ingestVideoLink("n1")
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalled())
    store.isReadOnly = true
    follow.resolve({ status: "completed", videoUrl: FILE })
    expect(await pending).toEqual({ status: "superseded" })
  })
})

describe("ingestVideoLink — failures", () => {
  it("stores the class AND the server's words", async () => {
    followVideoDownload.mockResolvedValue({ status: "failed", error: "ERROR: [instagram] abc: Private video" })
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "private" })
    expect(dataOf()).toMatchObject({
      downloadStatus: "failed",
      downloadErrorCode: "private",
      downloadError: "ERROR: [instagram] abc: Private video",
      downloadId: "",
    })
  })

  it("fails cleanly when the download cannot even be started", async () => {
    startVideoDownload.mockRejectedValue(new Error("Must be a social video URL"))
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "generic" })
    expect(dataOf()).toMatchObject({ downloadStatus: "failed", downloadError: "Must be a social video URL" })
  })

  it("names the server's per-account cap for what it is", async () => {
    startVideoDownload.mockRejectedValue(new Error("Too many downloads are running — wait for one to finish and try again."))
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "busy" })
  })

  it("starts over ONCE when the server forgot the download mid-way (a deploy restarted it)", async () => {
    followVideoDownload.mockResolvedValueOnce({ status: "expired" })
    startVideoDownload.mockResolvedValueOnce({ downloadId: "dl-1" }).mockResolvedValueOnce({ downloadId: "dl-2" })
    seed({ youtubeUrl: TIKTOK })
    expect((await ingestVideoLink("n1")).status).toBe("completed")
    expect(startVideoDownload).toHaveBeenCalledTimes(2)
    expect(followVideoDownload).toHaveBeenLastCalledWith("dl-2", expect.anything())
  })

  it("does not loop when the server keeps forgetting", async () => {
    followVideoDownload.mockResolvedValue({ status: "expired" })
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "connection" })
    expect(startVideoDownload).toHaveBeenCalledTimes(2)
  })
})

describe("retryVideoLinkIngest — the Retry button", () => {
  it("re-attaches to a download whose stream was LOST instead of downloading twice", async () => {
    followVideoDownload.mockResolvedValueOnce({ status: "lost" })
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "connection" })
    expect(dataOf()).toMatchObject({
      downloadStatus: "failed",
      downloadErrorCode: "connection",
      downloadId: "dl-1",
      downloadIdUrl: TIKTOK,
    })

    // The server may well have finished the download meanwhile.
    expect((await retryVideoLinkIngest("n1")).status).toBe("completed")
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
    expect(followVideoDownload).toHaveBeenLastCalledWith("dl-1", expect.anything())
  })

  it("starts over when that download is gone", async () => {
    seed({ youtubeUrl: TIKTOK, downloadStatus: "failed", downloadId: "dl-9", downloadIdUrl: TIKTOK })
    followVideoDownload.mockResolvedValueOnce({ status: "expired" })
    expect((await retryVideoLinkIngest("n1")).status).toBe("completed")
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
  })

  it("brings a long YouTube video back to the chooser — stored 'whole' is never a reason to download", async () => {
    fetchVideoMetadata.mockResolvedValue(LONG)
    // Every field here can be authored by whoever wrote the workflow.
    seed({ youtubeUrl: YT, downloadStatus: "failed", downloadMode: "whole", downloadErrorCode: "generic" })
    expect(await retryVideoLinkIngest("n1")).toEqual({ status: "needs-choice", durationSec: 5530 })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("probes even after a re-attach came back empty — a stored id is not a way around the question", async () => {
    fetchVideoMetadata.mockResolvedValue(LONG)
    followVideoDownload.mockResolvedValueOnce({ status: "expired" })
    seed({ youtubeUrl: YT, downloadStatus: "failed", downloadMode: "whole", downloadId: "crafted", downloadIdUrl: YT })
    expect(await retryVideoLinkIngest("n1")).toEqual({ status: "needs-choice", durationSec: 5530 })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("asks the server to accept a silent file only on the explicit second try", async () => {
    seed({ youtubeUrl: TIKTOK, downloadStatus: "failed", downloadErrorCode: "no_audio" })
    await retryVideoLinkIngest("n1", { allowSilent: true })
    expect(startVideoDownload).toHaveBeenCalledWith(TIKTOK, { requireAudio: false, ...CONFIRMED })
  })
})

describe("ingestVideoLink — one download per node, and no late answers", () => {
  it("joins the download already running for the same request", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValue(follow.promise)
    seed({ youtubeUrl: TIKTOK })
    const first = ingestVideoLink("n1")
    const second = ingestVideoLink("n1")
    expect(isVideoLinkIngestLive("n1")).toBe(true)
    follow.resolve({ status: "completed", videoUrl: FILE })
    expect(await first).toEqual(await second)
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
    expect(isVideoLinkIngestLive("n1")).toBe(false)
  })

  it("never writes a finished download onto a node whose link has changed meanwhile", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValue(follow.promise)
    seed({ youtubeUrl: TIKTOK })
    const pending = ingestVideoLink("n1")
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalled())

    store.updateNodeData("n1", { youtubeUrl: YT }) // edited somewhere the controller is not looking
    follow.resolve({ status: "completed", videoUrl: FILE })

    expect(await pending).toEqual({ status: "superseded" })
    // The old link's file never lands on the new link.
    expect(dataOf().downloadedVideoUrl).toBe("")
    expect(dataOf().downloadedFromUrl).toBe("")
  })

  it("aborts the running follow when a new request replaces it", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValueOnce(follow.promise)
    seed({ youtubeUrl: YT, needsRangeChoice: true })
    const first = ingestVideoLink("n1", { mode: "whole" })
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalledTimes(1))
    const signal = (followVideoDownload.mock.calls[0][1] as { signal: AbortSignal }).signal

    const second = ingestVideoLink("n1", { mode: "section", section: { startSec: 0, endSec: 20 } })
    expect(signal.aborted).toBe(true)
    follow.resolve({ status: "aborted" })
    expect(await first).toEqual({ status: "superseded" })
    expect((await second).status).toBe("completed")
  })

  it("writes progress as TRANSIENT-only patches, and only when it moved", async () => {
    followVideoDownload.mockImplementation(async (_id: string, opts: { onProgress(p: unknown): void }) => {
      opts.onProgress({ phase: "downloading", percent: 10 })
      opts.onProgress({ phase: "downloading", percent: 10 })
      opts.onProgress({ phase: "processing", percent: 90 })
      return { status: "completed", videoUrl: FILE }
    })
    seed({ youtubeUrl: TIKTOK })
    await ingestVideoLink("n1")
    const ticks = store.patches.filter((p) => "downloadPercent" in p.patch)
    expect(ticks.map((t) => t.patch)).toEqual([
      { downloadPercent: 0, downloadPhase: "downloading" },
      { downloadPercent: 10, downloadPhase: "downloading" },
      { downloadPercent: 90, downloadPhase: "processing" },
    ])
    for (const tick of ticks) {
      expect(Object.keys(tick.patch).every((k) => TRANSIENT_RUNTIME_KEYS.has(k))).toBe(true)
    }
  })

  it("is not an undo step — Ctrl+Z after a download takes back the LINK, not the download's bookkeeping", async () => {
    seed({}, "n1", { ticked: false })
    setVideoLinkUrl("n1", TIKTOK)
    expect((await confirmVideoLink("n1")).status).toBe("completed")

    const undoable = store.patches.filter((p) => p.undoable)
    // The one thing the person did: change the link. The tick is session state, not a write.
    expect(undoable).toHaveLength(1)
    expect(undoable[0].patch.youtubeUrl).toBe(TIKTOK)
    expect(undo.skipping).toBe(false) // the flag is always handed back
  })
})

describe("the content rights box (rule 4)", () => {
  it("a pasted link fetches NOTHING until the box is ticked — only its title and picture are read", async () => {
    vi.useFakeTimers()
    seed({}, "n1", { ticked: false })
    setVideoLinkUrl("n1", YT)
    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS * 2)
    expect(fetchYouTubeOEmbed).toHaveBeenCalledTimes(1)
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(downloadYouTubeAudio).not.toHaveBeenCalled()
    expect(confirmLink).not.toHaveBeenCalled()
    expect(isVideoLinkConfirmed("n1")).toBe(false)
  })

  it("a download asked of an unticked node is refused without a request — Download, Retry and Run alike", async () => {
    seed({ youtubeUrl: TIKTOK }, "n1", { ticked: false })
    expect(await ingestVideoLink("n1")).toEqual({ status: "needs-confirmation" })
    expect(await retryVideoLinkIngest("n1")).toEqual({ status: "needs-confirmation" })
    expect(await ensureVideoLinksDownloaded(["n1"])).toEqual({ ok: false, nodeId: "n1", label: "Video URL", reason: "confirm" })
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(confirmLink).not.toHaveBeenCalled()
    expect(store.patches).toHaveLength(0)
  })

  it("the tick confirms the declaration for the link and fetches its sound and its video — one confirmation EACH", async () => {
    seed({ youtubeUrl: TIKTOK }, "n1", { ticked: false })
    confirmLink
      .mockResolvedValueOnce({ id: "conf-audio", declarationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" })
      .mockResolvedValueOnce({ id: "conf-video", declarationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" })
    expect((await confirmVideoLink("n1")).status).toBe("completed")
    expect(isVideoLinkConfirmed("n1")).toBe(true)
    await vi.waitFor(() => expect(dataOf().audioDownloadStatus).toBe("completed"))
    expect(confirmLink.mock.calls).toEqual([[TIKTOK], [TIKTOK]])
    expect(downloadYouTubeAudio).toHaveBeenCalledWith(TIKTOK, { confirmationId: "conf-audio" })
    expect(startVideoDownload).toHaveBeenCalledWith(TIKTOK, { confirmationId: "conf-video" })
  })

  it("the box is session state: never written to the node, so a saved workflow never carries a tick", async () => {
    seed({ youtubeUrl: TIKTOK }, "n1", { ticked: false })
    await confirmVideoLink("n1")
    await vi.waitFor(() => expect(dataOf().audioDownloadStatus).toBe("completed"))
    for (const { patch } of store.patches) {
      expect(patch.rightsConfirmationId ?? "").toBe("")
      expect("confirmed" in patch).toBe(false)
    }
  })

  it("a changed link unticks the box, and so does clearing it", () => {
    seed({ youtubeUrl: TIKTOK })
    expect(isVideoLinkConfirmed("n1")).toBe(true)
    setVideoLinkUrl("n1", YT)
    expect(isVideoLinkConfirmed("n1")).toBe(false)
    // A confirmation an agent wrote beside the old link goes with it.
    expect(dataOf().rightsConfirmationId).toBe("")
    setVideoLinkConfirmed("n1", true)
    clearVideoLink("n1")
    expect(isVideoLinkConfirmed("n1")).toBe(false)
  })

  it("a tick on a direct file link or an empty node is nothing — there is no import to confirm", () => {
    seed({ youtubeUrl: FILE }, "a", { ticked: false })
    seed({ youtubeUrl: "" }, "b", { ticked: false })
    setVideoLinkConfirmed("a", true)
    setVideoLinkConfirmed("b", true)
    expect(isVideoLinkConfirmed("a")).toBe(false)
    expect(isVideoLinkConfirmed("b")).toBe(false)
  })

  it("the restart after the server forgot a download records a fresh confirmation — one confirmation opens one download", async () => {
    followVideoDownload.mockResolvedValueOnce({ status: "expired" })
    startVideoDownload.mockResolvedValueOnce({ downloadId: "dl-1" }).mockResolvedValueOnce({ downloadId: "dl-2" })
    confirmLink
      .mockResolvedValueOnce({ id: "conf-first", declarationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" })
      .mockResolvedValueOnce({ id: "conf-second", declarationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" })
    seed({ youtubeUrl: TIKTOK })
    expect((await ingestVideoLink("n1")).status).toBe("completed")
    expect(startVideoDownload.mock.calls.map(([, o]) => o)).toEqual([{ confirmationId: "conf-first" }, { confirmationId: "conf-second" }])
  })

  it("a changed declaration unticks the box and fails as a rights problem — the person must read the new text", async () => {
    confirmLink.mockRejectedValueOnce(new DeclarationChangedError("changed"))
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "rights" })
    expect(isVideoLinkConfirmed("n1")).toBe(false)
    expect(dataOf()).toMatchObject({ downloadStatus: "failed", downloadErrorCode: "rights" })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("a confirmation the server refuses for another reason fails the download the same way, box still ticked", async () => {
    confirmLink.mockRejectedValueOnce(new Error("Authentication required"))
    seed({ youtubeUrl: TIKTOK })
    expect(await ingestVideoLink("n1")).toEqual({ status: "failed", code: "rights" })
    expect(isVideoLinkConfirmed("n1")).toBe(true)
    expect(dataOf().downloadError).toBe("Authentication required")
  })

  it("a re-attach needs no tick — that download was confirmed when it started", async () => {
    seed({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9", downloadIdUrl: TIKTOK }, "n1", { ticked: false })
    resumeVideoLinkIngest("n1")
    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("completed"))
    expect(confirmLink).not.toHaveBeenCalled()
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("…but the fresh start after a re-attach found nothing does, and an unticked node goes back to idle", async () => {
    followVideoDownload.mockResolvedValueOnce({ status: "expired" })
    seed({ youtubeUrl: TIKTOK, downloadStatus: "failed", downloadId: "dl-9", downloadIdUrl: TIKTOK }, "n1", { ticked: false })
    expect(await retryVideoLinkIngest("n1")).toEqual({ status: "needs-confirmation" })
    expect(dataOf()).toMatchObject({ downloadStatus: "idle", downloadId: "" })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("the audio track fails as a rights problem on the node when its confirmation is refused", async () => {
    confirmLink.mockRejectedValueOnce(new DeclarationChangedError("changed"))
    seed({ youtubeUrl: TIKTOK, downloadedVideoUrl: FILE, downloadedFromUrl: TIKTOK }, "n1", { ticked: false })
    await confirmVideoLink("n1")
    await vi.waitFor(() => expect(dataOf().audioDownloadStatus).toBe("failed"))
    expect(dataOf().audioDownloadError).toBe("changed")
    expect(downloadYouTubeAudio).not.toHaveBeenCalled()
    expect(isVideoLinkConfirmed("n1")).toBe(false)
  })

  it("a tick for a NEW link starts its own track fetch instead of joining the old link's", async () => {
    const first = deferred<{ url: string; thumbnailUrl: null }>()
    downloadYouTubeAudio.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ url: "https://cdn.nodaro.ai/audios/b.mp3", thumbnailUrl: null })
    seed({ youtubeUrl: TIKTOK }, "n1", { ticked: false })
    void confirmVideoLink("n1")
    await vi.waitFor(() => expect(downloadYouTubeAudio).toHaveBeenCalledTimes(1))

    setVideoLinkUrl("n1", YT)
    void confirmVideoLink("n1")
    await vi.waitFor(() => expect(downloadYouTubeAudio).toHaveBeenCalledTimes(2))
    expect(downloadYouTubeAudio).toHaveBeenLastCalledWith(YT, CONFIRMED)
    await vi.waitFor(() => expect(dataOf().downloadedAudioUrl).toBe("https://cdn.nodaro.ai/audios/b.mp3"))
    // The old link's track lands nowhere.
    first.resolve({ url: "https://cdn.nodaro.ai/audios/a.mp3", thumbnailUrl: null })
    await new Promise((r) => setTimeout(r, 0))
    expect(dataOf().downloadedAudioUrl).toBe("https://cdn.nodaro.ai/audios/b.mp3")
  })

  it("the tick's own state goes with the workflow: another workflow opens with every box unticked — a new canvas getting its id on its first save keeps them", () => {
    seed({ youtubeUrl: TIKTOK })
    workflowListeners.forEach((l) => l({ workflowId: "w1" }, { workflowId: null }))
    expect(isVideoLinkConfirmed("n1")).toBe(true)
    workflowListeners.forEach((l) => l({ workflowId: "w2" }, { workflowId: "w1" }))
    expect(isVideoLinkConfirmed("n1")).toBe(false)
    seed({ youtubeUrl: TIKTOK })
    workflowListeners.forEach((l) => l({ workflowId: null }, { workflowId: "w2" }))
    expect(isVideoLinkConfirmed("n1")).toBe(false)
  })

  it("the box of a node's own link (a Dubbing node's Source link) goes with the workflow too", () => {
    const LINK = "https://example.com/talks/keynote"
    tickNodeLinkRights("d1", LINK)
    workflowListeners.forEach((l) => l({ workflowId: "w1" }, { workflowId: null }))
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(true)
    workflowListeners.forEach((l) => l({ workflowId: "w2" }, { workflowId: "w1" }))
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(false)
  })

  describe("findUnconfirmedVideoLink — the question the Run gate asks before it fetches anything", () => {
    it("names the first unticked node that has something left to fetch; a ticked, fetched, direct or in-flight one is passed over", async () => {
      seed({ youtubeUrl: TIKTOK, label: "Reel" }, "unticked", { ticked: false })
      seed({ youtubeUrl: TIKTOK }, "ticked")
      seed({ youtubeUrl: TIKTOK, downloadedVideoUrl: FILE, downloadedFromUrl: TIKTOK }, "fetched", { ticked: false })
      seed({ youtubeUrl: FILE }, "direct", { ticked: false })
      expect(findUnconfirmedVideoLink(["ticked", "fetched", "direct", "unticked"])).toEqual({ ok: false, nodeId: "unticked", label: "Reel", reason: "confirm" })
      // For the sound: the track, not the file, is what counts.
      expect(findUnconfirmedVideoLink(["fetched"], { audio: true })).toMatchObject({ nodeId: "fetched" })
      seed({ youtubeUrl: TIKTOK, downloadedAudioUrl: "https://cdn.nodaro.ai/audios/have.mp3" }, "tracked", { ticked: false })
      expect(findUnconfirmedVideoLink(["tracked"], { audio: true })).toBeNull()
    })

    it("a download already running was confirmed when it started", async () => {
      const follow = deferred<unknown>()
      followVideoDownload.mockReturnValue(follow.promise)
      seed({ youtubeUrl: TIKTOK })
      const pending = ingestVideoLink("n1")
      await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalled())
      setVideoLinkConfirmed("n1", false)
      expect(findUnconfirmedVideoLink(["n1"])).toBeNull()
      follow.resolve({ status: "completed", videoUrl: FILE })
      await pending
    })
  })

  describe("ensureVideoLinkAudio — the sound a Transcribe-only run reads from the node", () => {
    it("fetches a missing track under the tick, and costs nothing when the node holds one", async () => {
      seed({ youtubeUrl: TIKTOK }, "a")
      seed({ youtubeUrl: TIKTOK, downloadedAudioUrl: "https://cdn.nodaro.ai/audios/have.mp3" }, "b")
      seed({ youtubeUrl: FILE }, "c")
      expect(await ensureVideoLinkAudio(["a", "b", "c"])).toEqual({ ok: true, downloaded: 1 })
      expect(downloadYouTubeAudio).toHaveBeenCalledTimes(1)
      expect(downloadYouTubeAudio).toHaveBeenCalledWith(TIKTOK, CONFIRMED)
      expect(dataOf("a").downloadedAudioUrl).toBe("https://cdn.nodaro.ai/audios/a.mp3")
    })

    it("stops the run on an unticked node, before any request — even one listed after a ticked node", async () => {
      seed({ youtubeUrl: TIKTOK }, "a")
      seed({ youtubeUrl: TIKTOK, label: "Episode" }, "b", { ticked: false })
      expect(await ensureVideoLinkAudio(["a", "b"])).toEqual({ ok: false, nodeId: "b", label: "Episode", reason: "confirm" })
      expect(confirmLink).not.toHaveBeenCalled()
      expect(downloadYouTubeAudio).not.toHaveBeenCalled()
    })

    it("stops the run on a failed track, naming the class", async () => {
      downloadYouTubeAudio.mockRejectedValueOnce(new Error("Too many downloads are running"))
      seed({ youtubeUrl: TIKTOK })
      expect(await ensureVideoLinkAudio(["n1"])).toEqual({ ok: false, nodeId: "n1", label: "Video URL", reason: "failed", code: "busy" })
    })

    it("can be abandoned — the wait ends at once, the fetch carries on", async () => {
      const audio = deferred<{ url: string; thumbnailUrl: null }>()
      downloadYouTubeAudio.mockReturnValue(audio.promise)
      seed({ youtubeUrl: TIKTOK })
      const controller = new AbortController()
      const gate = ensureVideoLinkAudio(["n1"], { signal: controller.signal })
      await vi.waitFor(() => expect(downloadYouTubeAudio).toHaveBeenCalled())
      controller.abort()
      // The wait is over before the track lands.
      expect(await gate).toEqual({ ok: false, reason: "cancelled" })
      audio.resolve({ url: "https://cdn.nodaro.ai/audios/a.mp3", thumbnailUrl: null })
      await vi.waitFor(() => expect(dataOf().downloadedAudioUrl).toBe("https://cdn.nodaro.ai/audios/a.mp3"))
    })

    it("a refused confirmation on the track is a rights failure, by its class, not its words", async () => {
      confirmLink.mockRejectedValueOnce(Object.assign(new Error("Used already"), { code: "rights_confirmation_used" }))
      seed({ youtubeUrl: TIKTOK })
      expect(await ensureVideoLinkAudio(["n1"])).toEqual({ ok: false, nodeId: "n1", label: "Video URL", reason: "failed", code: "rights" })
    })

    it("fetches nothing on a read-only canvas", async () => {
      seed({ youtubeUrl: TIKTOK })
      store.isReadOnly = true
      expect(await ensureVideoLinkAudio(["n1"])).toEqual({ ok: true, downloaded: 0 })
      expect(confirmLink).not.toHaveBeenCalled()
    })
  })
})

describe("setVideoLinkUrl", () => {
  it("resets everything that belonged to the previous link, in one write", () => {
    seed({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT, downloadStatus: "completed", title: "old", downloadId: "dl-1", downloadIdUrl: YT })
    setVideoLinkUrl("n1", TIKTOK)
    expect(store.patches).toHaveLength(1)
    expect(dataOf()).toMatchObject({
      youtubeUrl: TIKTOK,
      videoId: "7676964064458738952",
      downloadedVideoUrl: "",
      downloadedFromUrl: "",
      downloadStatus: "idle",
      downloadId: "",
      downloadIdUrl: "",
      downloadMode: "auto",
      needsRangeChoice: false,
      downloadedAudioUrl: "",
      audioDownloadStatus: "idle",
    })
  })

  it("shows YouTube's own thumbnail at once, then the oEmbed title", async () => {
    vi.useFakeTimers()
    seed()
    setVideoLinkUrl("n1", YT)
    expect(dataOf().thumbnailUrl).toBe("https://img.youtube.com/vi/aqz-KE-bpKQ/hqdefault.jpg")
    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS + 1)
    await vi.waitFor(() => expect(dataOf().title).toBe("A short clip"))
  })

  it("three edits are ONE link to confirm — the tick fetches the last one, once", async () => {
    vi.useFakeTimers()
    seed({}, "n1", { ticked: false })
    setVideoLinkUrl("n1", "https://www.instagram.com/reel/A")
    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS - 50)
    setVideoLinkUrl("n1", "https://www.instagram.com/reel/AB")
    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS - 50)
    setVideoLinkUrl("n1", "https://www.instagram.com/reel/ABC")
    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS + 1)
    expect(startVideoDownload).not.toHaveBeenCalled()
    const ticked = confirmVideoLink("n1")
    await vi.advanceTimersByTimeAsync(1)
    expect((await ticked).status).toBe("completed")
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
    expect(startVideoDownload).toHaveBeenCalledWith("https://www.instagram.com/reel/ABC", CONFIRMED)
    expect(downloadYouTubeAudio).toHaveBeenCalledTimes(1)
  })

  it("a tick INSIDE the typing pause still reads the title — and the pause running out afterwards adds nothing", async () => {
    vi.useFakeTimers()
    seed({}, "n1", { ticked: false })
    setVideoLinkUrl("n1", YT)
    // The person is faster than the pause: the box is already on screen.
    const ticked = confirmVideoLink("n1")
    await vi.advanceTimersByTimeAsync(1)
    expect((await ticked).status).toBe("completed")
    expect(downloadYouTubeAudio).toHaveBeenCalledTimes(1)
    expect(fetchYouTubeOEmbed).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS * 2)
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
    expect(downloadYouTubeAudio).toHaveBeenCalledTimes(1)
    expect(fetchYouTubeOEmbed).toHaveBeenCalledTimes(1)
  })

  it("starts nothing for a direct file link", async () => {
    vi.useFakeTimers()
    seed()
    setVideoLinkUrl("n1", FILE)
    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS * 2)
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(downloadYouTubeAudio).not.toHaveBeenCalled()
    expect(dataOf()).toMatchObject({ youtubeUrl: FILE, videoId: "" })
  })

  it("fetches the audio track too (on the tick), and never writes it onto a changed link", async () => {
    const audio = deferred<{ url: string; thumbnailUrl: null }>()
    downloadYouTubeAudio.mockReturnValue(audio.promise)
    seed({}, "n1", { ticked: false })
    setVideoLinkUrl("n1", TIKTOK)
    void confirmVideoLink("n1")
    await vi.waitFor(() => expect(downloadYouTubeAudio).toHaveBeenCalledTimes(1))
    expect(dataOf().audioDownloadStatus).toBe("downloading")

    clearVideoLink("n1")
    audio.resolve({ url: "https://cdn.nodaro.ai/audios/a.mp3", thumbnailUrl: null })
    await new Promise((r) => setTimeout(r, 0))
    expect(dataOf().downloadedAudioUrl).toBe("")
    expect(dataOf().audioDownloadStatus).toBe("idle")
  })

  it("clearVideoLink empties the node and drops the running download", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValue(follow.promise)
    seed({ youtubeUrl: TIKTOK })
    const pending = ingestVideoLink("n1")
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalled())
    clearVideoLink("n1")
    expect(isVideoLinkIngestLive("n1")).toBe(false)
    follow.resolve({ status: "aborted" })
    expect(await pending).toEqual({ status: "superseded" })
    expect(dataOf()).toMatchObject({ youtubeUrl: "", videoId: "", downloadStatus: "idle" })
  })
})

describe("resumeVideoLinkIngest — a node reopened mid-download", () => {
  it("re-attaches to the download it was following, without starting another", async () => {
    seed({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9", downloadIdUrl: TIKTOK })
    resumeVideoLinkIngest("n1")
    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("completed"))
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(followVideoDownload).toHaveBeenCalledWith("dl-9", expect.anything())
    expect(dataOf()).toMatchObject({ downloadedVideoUrl: FILE, downloadedFromUrl: TIKTOK })
  })

  it("labels a re-attached PART as the part it is", async () => {
    seed({
      youtubeUrl: YT, downloadStatus: "downloading", downloadId: "dl-9", downloadIdUrl: YT,
      downloadMode: "section", sectionStartSec: 30, sectionEndSec: 95,
    })
    resumeVideoLinkIngest("n1")
    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("completed"))
    expect(dataOf().downloadedSection).toEqual({ startSec: 30, endSec: 95 })
  })

  it("NEVER starts a download: when the server has forgotten it, the node just goes back to idle", async () => {
    followVideoDownload.mockResolvedValueOnce({ status: "expired" })
    seed({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9", downloadIdUrl: TIKTOK })
    resumeVideoLinkIngest("n1")
    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("idle"))
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(dataOf()).toMatchObject({ downloadId: "", downloadIdUrl: "" })
  })

  it("opening a workflow somebody else wrote costs nothing — crafted 'downloading' nodes start no download", async () => {
    followVideoDownload.mockResolvedValue({ status: "expired" })
    fetchVideoMetadata.mockResolvedValue(LONG)
    // What a hostile template would carry: in-flight status, an id, "whole".
    for (let i = 0; i < 5; i++) {
      seed({ youtubeUrl: YT, downloadStatus: "downloading", downloadId: `x${i}`, downloadIdUrl: YT, downloadMode: "whole" }, `n${i}`)
      resumeVideoLinkIngest(`n${i}`)
    }
    await vi.waitFor(() => expect(store.nodes.every((n) => n.data.downloadStatus === "idle")).toBe(true))
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
  })

  it("never follows an id that was made for ANOTHER link — that file belongs to the old link", async () => {
    // The link was rewritten outside the editor (an agent, an import) while
    // link A was downloading: status and id survive, the link is now B.
    seed({ youtubeUrl: YT, downloadStatus: "downloading", downloadId: "dl-tiktok", downloadIdUrl: TIKTOK })
    resumeVideoLinkIngest("n1")
    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("idle"))
    expect(followVideoDownload).not.toHaveBeenCalled()
    expect(dataOf().downloadedVideoUrl).toBeUndefined()
  })

  it("an id with no recorded link is not followed either", async () => {
    seed({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9" })
    resumeVideoLinkIngest("n1")
    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("idle"))
    expect(followVideoDownload).not.toHaveBeenCalled()
  })

  it("settles a probe that was cut short back to idle", async () => {
    seed({ youtubeUrl: YT, downloadStatus: "checking" })
    resumeVideoLinkIngest("n1")
    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("idle"))
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("un-sticks a node whose link changed under a running download", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValueOnce(follow.promise)
    seed({ youtubeUrl: TIKTOK })
    const pending = ingestVideoLink("n1")
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalledTimes(1))

    store.updateNodeData("n1", { youtubeUrl: YT }) // out-of-band; status still says "downloading"
    resumeVideoLinkIngest("n1") // the card's effect re-fires on the link change

    await vi.waitFor(() => expect(dataOf().downloadStatus).toBe("idle"))
    follow.resolve({ status: "aborted" })
    expect(await pending).toEqual({ status: "superseded" })
    expect(startVideoDownload).toHaveBeenCalledTimes(1) // nothing new was started
  })

  it("leaves every settled state alone", () => {
    seed({ youtubeUrl: YT }, "idle")
    seed({ youtubeUrl: YT, downloadStatus: "failed" }, "failed")
    seed({ youtubeUrl: YT, needsRangeChoice: true }, "choose")
    seed({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT }, "ready")
    for (const id of ["idle", "failed", "choose", "ready"]) resumeVideoLinkIngest(id)
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).not.toHaveBeenCalled()
    expect(followVideoDownload).not.toHaveBeenCalled()
    expect(store.patches).toHaveLength(0)
  })

  it("does not double up on a download this tab is already following", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValue(follow.promise)
    seed({ youtubeUrl: TIKTOK })
    const pending = ingestVideoLink("n1")
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalledTimes(1))
    resumeVideoLinkIngest("n1")
    follow.resolve({ status: "completed", videoUrl: FILE })
    await pending
    expect(followVideoDownload).toHaveBeenCalledTimes(1)
  })
})

describe("ensureVideoLinksDownloaded — the gate in front of Run", () => {
  it("is free when every node already holds its file (or has none to fetch)", async () => {
    seed({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT }, "a")
    seed({ youtubeUrl: FILE }, "b")
    seed({ youtubeUrl: "" }, "c")
    expect(await ensureVideoLinksDownloaded(["a", "b", "c"])).toEqual({ ok: true, downloaded: 0 })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("downloads what is missing and waits for it", async () => {
    seed({ youtubeUrl: TIKTOK }, "a")
    seed({ youtubeUrl: YT }, "b")
    expect(await ensureVideoLinksDownloaded(["a", "b"])).toEqual({ ok: true, downloaded: 2 })
    expect(dataOf("a").downloadedVideoUrl).toBe(FILE)
    expect(dataOf("b").downloadedVideoUrl).toBe(FILE)
  })

  it("does not wait out the typing pause — Run means now, and joins the download the tick started", async () => {
    vi.useFakeTimers()
    seed({}, "n1", { ticked: false })
    setVideoLinkUrl("n1", TIKTOK)
    void confirmVideoLink("n1")
    const result = ensureVideoLinksDownloaded(["n1"])
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual({ ok: true, downloaded: 1 })
    await vi.advanceTimersByTimeAsync(VIDEO_LINK_INGEST_DEBOUNCE_MS * 2)
    expect(startVideoDownload).toHaveBeenCalledTimes(1) // the pending timer did not fire a second one
    // The audio track is what Transcribe / Suno Cover read — Run must not lose it.
    expect(downloadYouTubeAudio).toHaveBeenCalledTimes(1)
  })

  it("blocks on a long video nobody chose a part of — BEFORE downloading anything else", async () => {
    seed({ youtubeUrl: TIKTOK }, "clip")
    seed({ youtubeUrl: YT, needsRangeChoice: true, videoDurationSec: 5530, label: "Keynote" }, "talk")
    expect(await ensureVideoLinksDownloaded(["clip", "talk"])).toEqual({
      ok: false,
      nodeId: "talk",
      label: "Keynote",
      reason: "choose",
    })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("never downloads a long video on the strength of stored data — Run probes, then asks", async () => {
    fetchVideoMetadata.mockResolvedValue(LONG)
    seed({ youtubeUrl: YT, downloadStatus: "failed", downloadMode: "whole", label: "Keynote" })
    expect(await ensureVideoLinksDownloaded(["n1"])).toEqual({ ok: false, nodeId: "n1", label: "Keynote", reason: "choose" })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("WAITS for a whole long video the person is already downloading — it never replaces it with a probe", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValueOnce(follow.promise)
    seed({ youtubeUrl: YT, needsRangeChoice: true })
    void ingestVideoLink("n1", { mode: "whole" })
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalledTimes(1))

    const gate = ensureVideoLinksDownloaded(["n1"])
    follow.resolve({ status: "completed", videoUrl: FILE })
    expect(await gate).toEqual({ ok: true, downloaded: 1 })
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
  })

  it("asks for itself when the re-attach it joined found nothing left", async () => {
    followVideoDownload.mockResolvedValueOnce({ status: "expired" })
    seed({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9", downloadIdUrl: TIKTOK })
    resumeVideoLinkIngest("n1")
    expect(await ensureVideoLinksDownloaded(["n1"])).toEqual({ ok: true, downloaded: 1 })
    expect(startVideoDownload).toHaveBeenCalledTimes(1)
  })

  it(`runs at most ${ENSURE_CONCURRENCY} downloads side by side — under the server's per-account cap`, async () => {
    const follows = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>(), deferred<unknown>()]
    let n = 0
    followVideoDownload.mockImplementation(() => follows[n++].promise)
    const ids = ["a", "b", "c", "d"]
    ids.forEach((id) => seed({ youtubeUrl: `${TIKTOK}?n=${id}` }, id))

    const gate = ensureVideoLinksDownloaded(ids)
    await vi.waitFor(() => expect(startVideoDownload).toHaveBeenCalledTimes(ENSURE_CONCURRENCY))
    await new Promise((r) => setTimeout(r, 20))
    expect(startVideoDownload).toHaveBeenCalledTimes(ENSURE_CONCURRENCY)

    follows.forEach((f) => f.resolve({ status: "completed", videoUrl: FILE }))
    expect(await gate).toEqual({ ok: true, downloaded: 4 })
  })

  it("stops taking more once one is refused — the run is not going to start", async () => {
    followVideoDownload.mockResolvedValue({ status: "failed", error: "Private video" })
    const ids = ["a", "b", "c", "d", "e", "f"]
    ids.forEach((id) => seed({ youtubeUrl: `${TIKTOK}?n=${id}`, label: id }, id))
    const result = await ensureVideoLinksDownloaded(ids)
    expect(result).toMatchObject({ ok: false, reason: "failed", code: "private" })
    expect(startVideoDownload.mock.calls.length).toBeLessThanOrEqual(ENSURE_CONCURRENCY)
  })

  it("blocks on a failed download, naming the node and the class", async () => {
    followVideoDownload.mockResolvedValue({ status: "failed", error: "Private video" })
    seed({ youtubeUrl: TIKTOK, label: "Reel" })
    expect(await ensureVideoLinksDownloaded(["n1"])).toEqual({
      ok: false,
      nodeId: "n1",
      label: "Reel",
      reason: "failed",
      code: "private",
    })
  })

  it("retries a node whose last download failed — Run is a fresh attempt", async () => {
    seed({ youtubeUrl: TIKTOK, downloadStatus: "failed", downloadErrorCode: "generic" })
    expect(await ensureVideoLinksDownloaded(["n1"])).toEqual({ ok: true, downloaded: 1 })
  })

  it("can be abandoned — the wait ends, the download carries on", async () => {
    const follow = deferred<unknown>()
    followVideoDownload.mockReturnValue(follow.promise)
    seed({ youtubeUrl: TIKTOK })
    const controller = new AbortController()
    const gate = ensureVideoLinksDownloaded(["n1"], { signal: controller.signal })
    await vi.waitFor(() => expect(followVideoDownload).toHaveBeenCalled())
    controller.abort()
    expect(await gate).toEqual({ ok: false, reason: "cancelled" })
    expect(isVideoLinkIngestLive("n1")).toBe(true)

    follow.resolve({ status: "completed", videoUrl: FILE })
    await vi.waitFor(() => expect(dataOf().downloadedVideoUrl).toBe(FILE))
  })
})

describe("a link swap drops the same state in the editor and in an app run", () => {
  it("everything the editor resets when the link changes is in the server's list for an overridden link", () => {
    const dropped = new Set<string>(VIDEO_LINK_DERIVED_FIELDS)
    for (const key of [...Object.keys(CLEARED_DOWNLOAD), "videoId", "title", "thumbnailUrl"]) {
      expect(dropped.has(key), `${key} would outlive an overridden link in an app run`).toBe(true)
    }
  })
})
