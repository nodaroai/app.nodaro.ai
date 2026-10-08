import { describe, it, expect, vi } from "vitest"
import { overriddenVideoLinkIds, prepareVideoLinksForRun } from "../orchestrator-video-links.js"
import type { VideoLinkFetchDeps } from "../../services/workflow-engine/video-link-fetch.js"
import type { SimpleNode } from "../../services/workflow-engine/types.js"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"

// The graph as the orchestrator hands it over: the request's link is already merged onto the node.
const nodes = (): SimpleNode[] => [
  { id: "src", type: "youtube-video", data: { label: "Episode", youtubeUrl: YT } } as SimpleNode,
  { id: "va", type: "video-analysis", data: {} } as SimpleNode,
]
const edges = [{ source: "src", target: "va" }]

const deps = (over: Partial<VideoLinkFetchDeps> = {}): VideoLinkFetchDeps => ({
  probe: vi.fn().mockResolvedValue({ durationSec: 60, title: null, isLive: false }),
  downloadVideo: vi.fn().mockResolvedValue({ videoUrl: FILE }),
  downloadAudio: vi.fn().mockResolvedValue("https://cdn.nodaro.ai/a.mp3"),
  ...over,
})

/** A download that only ends when the run's signal aborts it. */
const hangsUntilAborted = () =>
  vi.fn().mockImplementation(
    ({ signal }: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
  )

describe("overriddenVideoLinkIds", () => {
  it("is the Video URL nodes whose link the request set — and no other node, and no other field", () => {
    const list = [...nodes(), { id: "up", type: "upload-video", data: {} } as SimpleNode]
    expect([...overriddenVideoLinkIds(list, { src: { youtubeUrl: YT }, up: { youtubeUrl: YT } })]).toEqual(["src"])
    expect([...overriddenVideoLinkIds(list, { src: { label: "x" } })]).toEqual([])
    expect([...overriddenVideoLinkIds(list, undefined)]).toEqual([])
  })
})

describe("prepareVideoLinksForRun", () => {
  it("is inert when the graph holds no post link to fetch: nothing loaded, nothing polled", async () => {
    const controlStatus = vi.fn()
    const direct = [
      { id: "src", type: "youtube-video", data: { label: "Episode", youtubeUrl: "https://cdn.example.com/clip.mp4" } } as SimpleNode,
      { id: "va", type: "video-analysis", data: {} } as SimpleNode,
    ]
    const loadRecorded = vi.fn()
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: direct, edges, executingIds: new Set(["va"]), inputOverrides: { va: { label: "x" } }, controlStatus, loadRecorded,
    })
    expect(outcome).toEqual({ kind: "ok", inputOverrides: { va: { label: "x" } }, fetched: [], files: {} })
    expect(controlStatus).not.toHaveBeenCalled()
    expect(loadRecorded).not.toHaveBeenCalled()
  })

  it("a link SAVED in the workflow is fetched although the request set nothing (decided 2026-10-08) — and not pinned, since the lock refuses a pin on a node the request did not name", async () => {
    const list = nodes()
    const d = deps()
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: list, edges, executingIds: new Set(["va"]), inputOverrides: undefined,
      controlStatus: async () => "running", deps: d,
    })
    expect(d.downloadVideo).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({
      kind: "ok",
      inputOverrides: undefined,
      fetched: ["src"],
      // …and kept, for the execution's record: the link it was fetched for, and the fields written.
      files: { src: { link: YT, data: expect.objectContaining({ downloadedVideoUrl: FILE, downloadedFromUrl: YT }) } },
    })
    expect(list[0]!.data).toMatchObject({ downloadedVideoUrl: FILE, downloadedFromUrl: YT })
  })

  it("a recorded file for the node's link is written onto the node instead of a download, and comes back in the record to keep", async () => {
    const list = nodes()
    const d = deps()
    const recorded = { src: { link: YT, data: { downloadedVideoUrl: "https://cdn.nodaro.ai/videos/earlier.mp4", downloadedFromUrl: YT, downloadStatus: "completed", downloadedSection: null } } }
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: list, edges, executingIds: new Set(["va"]), inputOverrides: undefined,
      controlStatus: async () => "running", deps: d, loadRecorded: async () => recorded, continued: true,
    })
    expect(d.downloadVideo).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: "ok", fetched: ["src"], files: recorded })
    expect(list[0]!.data).toMatchObject({ downloadedVideoUrl: "https://cdn.nodaro.ai/videos/earlier.mp4", downloadedFromUrl: YT })
  })

  it("a refusal in a continuation does not claim nothing was charged", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 5530, title: null, isLive: false }) })
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: nodes(), edges, executingIds: new Set(["va"]), inputOverrides: undefined,
      controlStatus: async () => "running", deps: d, continued: true,
    })
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.message).not.toMatch(/nothing was charged/i)
    expect(outcome.message).toMatch(/nothing more was charged/i)
  })

  it("a saved link whose file is already on the node is not fetched", async () => {
    const list = nodes()
    list[0] = { id: "src", type: "youtube-video", data: { label: "Episode", youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT } } as SimpleNode
    const d = deps()
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: list, edges, executingIds: new Set(["va"]), inputOverrides: undefined,
      controlStatus: async () => "running", deps: d,
    })
    expect(d.downloadVideo).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: "ok", fetched: [] })
  })

  it("writes the file onto a NEW data object and pins only what the run lock admits", async () => {
    const list = nodes()
    const before = list[0]!.data
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: list, edges, executingIds: new Set(["va"]), inputOverrides: { src: { youtubeUrl: YT } },
      controlStatus: async () => "running", deps: deps(),
    })
    expect(outcome).toMatchObject({ kind: "ok", fetched: ["src"] })
    expect(list[0]!.data).not.toBe(before)
    expect(list[0]!.data).toMatchObject({ downloadedVideoUrl: FILE, downloadedFromUrl: YT })
    expect(before).toEqual({ label: "Episode", youtubeUrl: YT })
    if (outcome.kind !== "ok") throw new Error("unreachable")
    expect(outcome.inputOverrides).toEqual({ src: { youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT } })
  })

  it("a consumer that is not executing (seeded, gated, outside the subset) does not make the link a download", async () => {
    const d = deps()
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: nodes(), edges, executingIds: new Set(), inputOverrides: { src: { youtubeUrl: YT } },
      controlStatus: async () => "running", deps: d,
    })
    expect(outcome).toMatchObject({ kind: "ok", fetched: [] })
    expect(d.downloadVideo).not.toHaveBeenCalled()
  })

  it("a stop of the run reaches a download in flight, and reports a cancel", async () => {
    let stopped = false
    const d = deps({
      downloadVideo: vi.fn().mockImplementation(
        ({ signal }: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
      ),
    })
    setTimeout(() => (stopped = true), 5)
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: nodes(), edges, executingIds: new Set(["va"]), inputOverrides: { src: { youtubeUrl: YT } },
      controlStatus: async () => (stopped ? "cancelled" : "running"), deps: d, pollMs: 2,
    })
    expect(outcome).toEqual({ kind: "stopped", by: "cancelled" })
  })

  it("a refusal comes back as a message", async () => {
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: nodes(), edges, executingIds: new Set(["va"]), inputOverrides: { src: { youtubeUrl: YT } },
      controlStatus: async () => "running",
      deps: deps({ probe: vi.fn().mockResolvedValue({ durationSec: 9000, title: null, isLive: false }) }),
    })
    expect(outcome).toMatchObject({ kind: "refused" })
  })
  it.each(["cancelled", "stopping", "discarded"] as const)("a %s run is reported as that status, so a Discard is not rewritten as a cancel", async (status) => {
    let stopped = false
    const d = deps({ downloadVideo: hangsUntilAborted() })
    setTimeout(() => (stopped = true), 5)
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: nodes(), edges, executingIds: new Set(["va"]), inputOverrides: { src: { youtubeUrl: YT } },
      controlStatus: async () => (stopped ? status : "running"), deps: d, pollMs: 2, drainSignal: new AbortController().signal,
    })
    expect(outcome).toEqual({ kind: "stopped", by: status })
  })

  it("a deploy drain reaches a download in flight, and is reported as a drain (not a cancel)", async () => {
    const drain = new AbortController()
    const d = deps({ downloadVideo: hangsUntilAborted() })
    setTimeout(() => drain.abort(), 5)
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: nodes(), edges, executingIds: new Set(["va"]), inputOverrides: { src: { youtubeUrl: YT } },
      controlStatus: async () => "running", deps: d, drainSignal: drain.signal,
    })
    expect(outcome).toEqual({ kind: "stopped", by: "drain" })
  })

  it("a worker that is already draining starts no download at all", async () => {
    const drain = new AbortController()
    drain.abort()
    const d = deps()
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: nodes(), edges, executingIds: new Set(["va"]), inputOverrides: { src: { youtubeUrl: YT } },
      controlStatus: async () => "running", deps: d, drainSignal: drain.signal,
    })
    expect(outcome).toEqual({ kind: "stopped", by: "drain" })
    expect(d.downloadVideo).not.toHaveBeenCalled()
  })

  it.each([
    ["Collect", "collect"],
    ["Group", "group"],
  ])("a Video URL reaching its consumer through a %s (a node that does not execute) is still fetched", async (_name, passThrough) => {
    const list = [
      { id: "src", type: "youtube-video", data: { label: "Episode", youtubeUrl: YT } } as SimpleNode,
      { id: "mid", type: passThrough, data: {} } as SimpleNode,
      { id: "cv", type: "combine-videos", data: {} } as SimpleNode,
    ]
    const d = deps()
    const outcome = await prepareVideoLinksForRun({
      userId: "u1", nodes: list, edges: [{ source: "src", target: "mid" }, { source: "mid", target: "cv" }],
      executingIds: new Set(["cv"]), inputOverrides: { src: { youtubeUrl: YT } }, controlStatus: async () => "running", deps: d,
    })
    expect(d.downloadVideo).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ kind: "ok", fetched: ["src"] })
  })
})
