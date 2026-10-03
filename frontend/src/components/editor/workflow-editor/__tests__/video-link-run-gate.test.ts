import { describe, it, expect, vi, beforeEach } from "vitest"

const store = { nodes: [] as unknown[], edges: [] as unknown[] }
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => store },
}))

const ensureVideoLinksDownloaded = vi.fn()
vi.mock("@/lib/video-link-ingest", () => ({
  ensureVideoLinksDownloaded: (...a: unknown[]) => ensureVideoLinksDownloaded(...a),
}))

const toastApi = vi.hoisted(() => ({
  loading: vi.fn((_message: string, _options?: { action?: { label: string; onClick(): void } }) => "toast-1"),
  dismiss: vi.fn(),
  error: vi.fn((_message: string, _options?: { description?: string; duration?: number; action?: { label: string; onClick(): void } }) => undefined),
}))
vi.mock("sonner", () => ({ toast: toastApi }))

import { CHOOSE_PART_TOAST_MS, choosePartMessage, ensureVideoLinksBeforeRun, videoLinkNodesFeeding } from "../video-link-run-gate"
import { FOCUS_NODES_EVENT } from "@/lib/canvas-focus-event"
import { translate } from "@/lib/i18n"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"

const link = (id: string, data: Record<string, unknown> = { youtubeUrl: YT }) => ({ id, type: "youtube-video", data })
const node = (id: string, type = "video-to-video", data: Record<string, unknown> = {}) => ({ id, type, data })
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

beforeEach(() => {
  vi.clearAllMocks()
  store.nodes = []
  store.edges = []
  ensureVideoLinksDownloaded.mockResolvedValue({ ok: true, downloaded: 1 })
})

describe("videoLinkNodesFeeding", () => {
  it("does not download a link that only a Content Recipe reads — it cites the page, never the file", () => {
    const nodes = [link("src"), node("recipe", "content-recipe")]
    expect(videoLinkNodesFeeding(["recipe"], nodes as never, [edge("src", "recipe")] as never)).toEqual([])
  })

  it("still downloads it when a node in the run watches the video too", () => {
    const nodes = [link("src"), node("va", "video-analysis"), node("recipe", "content-recipe")]
    const edges = [edge("src", "va"), edge("src", "recipe"), edge("va", "recipe")]
    expect(videoLinkNodesFeeding(["va", "recipe"], nodes as never, edges as never)).toEqual(["src"])
  })

  it("finds the un-downloaded link behind the nodes about to run — at any depth", () => {
    const nodes = [link("src"), node("pass", "trim-video"), node("run")]
    const edges = [edge("src", "pass"), edge("pass", "run")]
    expect(videoLinkNodesFeeding(["run"], nodes as never, edges as never)).toEqual(["src"])
  })

  it("ignores a link that feeds nothing in this run — a long video parked on the canvas must not block Run", () => {
    const nodes = [link("unused"), link("other"), node("run"), node("elsewhere")]
    const edges = [edge("other", "elsewhere")]
    expect(videoLinkNodesFeeding(["run"], nodes as never, edges as never)).toEqual([])
  })

  it("ignores a node that already holds its file, a direct file link, and an empty node", () => {
    const nodes = [
      link("ready", { youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT }),
      link("direct", { youtubeUrl: FILE }),
      link("empty", { youtubeUrl: "" }),
      node("run"),
    ]
    const edges = [edge("ready", "run"), edge("direct", "run"), edge("empty", "run")]
    expect(videoLinkNodesFeeding(["run"], nodes as never, edges as never)).toEqual([])
  })

  it("catches a file that belongs to a DIFFERENT link — the node would emit the wrong video", () => {
    const nodes = [
      link("stale", { youtubeUrl: "https://youtu.be/otherVideo01", downloadedVideoUrl: FILE, downloadedFromUrl: YT }),
      node("run"),
    ]
    expect(videoLinkNodesFeeding(["run"], nodes as never, [edge("stale", "run")] as never)).toEqual(["stale"])
  })

  it("survives a cycle", () => {
    const nodes = [link("src"), node("a"), node("b")]
    const edges = [edge("src", "a"), edge("a", "b"), edge("b", "a")]
    expect(videoLinkNodesFeeding(["b"], nodes as never, edges as never)).toEqual(["src"])
  })

  describe("a run that only needs the SOUND", () => {
    it.each(["transcribe", "suno-cover", "dubbing"])(
      "does not ask for the video when %s is the only reader — a podcast → Transcribe run must not download an hour of video",
      (consumer) => {
        const nodes = [link("src"), node("reader", consumer)]
        expect(videoLinkNodesFeeding(["reader"], nodes as never, [edge("src", "reader")] as never)).toEqual([])
      },
    )

    it("asks for it as soon as ONE reader in the run looks at the video", () => {
      const nodes = [link("src"), node("words", "transcribe"), node("cut", "trim-video")]
      const edges = [edge("src", "words"), edge("src", "cut")]
      expect(videoLinkNodesFeeding(["words", "cut"], nodes as never, edges as never)).toEqual(["src"])
    })

    it("judges by the readers IN the run — a video reader that is not running pulls nothing in", () => {
      const nodes = [link("src"), node("words", "transcribe"), node("cut", "trim-video")]
      const edges = [edge("src", "words"), edge("src", "cut")]
      expect(videoLinkNodesFeeding(["words"], nodes as never, edges as never)).toEqual([])
    })
  })

  it("a skipped node is not part of the run and pulls no link in", () => {
    const nodes = [link("src"), node("run", "video-to-video", { skipped: true })]
    expect(videoLinkNodesFeeding(["run"], nodes as never, [edge("src", "run")] as never)).toEqual([])
  })
})

describe("ensureVideoLinksBeforeRun", () => {
  it("costs nothing when no link needs fetching — no toast, no running flag, no call", async () => {
    store.nodes = [node("run")]
    const setIsRunning = vi.fn()
    expect(await ensureVideoLinksBeforeRun(["run"], setIsRunning)).toBe(true)
    expect(ensureVideoLinksDownloaded).not.toHaveBeenCalled()
    expect(setIsRunning).not.toHaveBeenCalled()
    expect(toastApi.loading).not.toHaveBeenCalled()
  })

  it("downloads first, holds the Run button meanwhile, and hands it back for the run to take", async () => {
    store.nodes = [link("src"), node("run")]
    store.edges = [edge("src", "run")]
    const setIsRunning = vi.fn()
    expect(await ensureVideoLinksBeforeRun(["run"], setIsRunning)).toBe(true)
    expect(ensureVideoLinksDownloaded).toHaveBeenCalledWith(["src"], { signal: expect.any(AbortSignal) })
    expect(setIsRunning.mock.calls).toEqual([[true], [false]])
    expect(toastApi.loading.mock.calls[0][0]).toBe(translate("en", "run.videoLinkDownloading"))
    expect(toastApi.dismiss).toHaveBeenCalledWith("toast-1")
    expect(toastApi.error).not.toHaveBeenCalled()
  })

  it("can always be left — Cancel on the toast ends the wait, quietly, and the run does not start", async () => {
    store.nodes = [link("src"), node("run")]
    store.edges = [edge("src", "run")]
    // The real controller answers "cancelled" when its signal fires.
    ensureVideoLinksDownloaded.mockImplementation(
      (_ids: string[], opts: { signal: AbortSignal }) =>
        new Promise((resolve) => opts.signal.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }))),
    )
    const setIsRunning = vi.fn()
    const gate = ensureVideoLinksBeforeRun(["run"], setIsRunning)
    await vi.waitFor(() => expect(toastApi.loading).toHaveBeenCalled())

    const action = toastApi.loading.mock.calls[0][1]?.action
    expect(action?.label).toBe(translate("en", "common.cancel"))
    action?.onClick()

    expect(await gate).toBe(false)
    expect(toastApi.error).not.toHaveBeenCalled()
    expect(setIsRunning).toHaveBeenLastCalledWith(false)
    expect(toastApi.dismiss).toHaveBeenCalledWith("toast-1")
  })

  it.each([
    ["choose", "run.videoLinkChoose"],
    ["failed", "run.videoLinkFailed"],
    ["changed", "run.videoLinkChanged"],
  ] as const)("stops the run on %s and names the node", async (reason, key) => {
    store.nodes = [link("src"), node("run")]
    store.edges = [edge("src", "run")]
    ensureVideoLinksDownloaded.mockResolvedValue({ ok: false, nodeId: "src", label: "Keynote", reason })
    const setIsRunning = vi.fn()
    expect(await ensureVideoLinksBeforeRun(["run"], setIsRunning)).toBe(false)
    expect(setIsRunning).toHaveBeenLastCalledWith(false)
    expect(toastApi.error).toHaveBeenCalledWith(translate("en", key, { label: "Keynote" }), expect.anything())
  })

  it("puts the reason of a failed download under the headline", async () => {
    store.nodes = [link("src"), node("run")]
    store.edges = [edge("src", "run")]
    ensureVideoLinksDownloaded.mockResolvedValue({ ok: false, nodeId: "src", label: "Reel", reason: "failed", code: "private" })
    await ensureVideoLinksBeforeRun(["run"], vi.fn())
    expect(toastApi.error).toHaveBeenCalledWith(
      translate("en", "run.videoLinkFailed", { label: "Reel" }),
      { description: translate("en", "videolink.errorPrivate") },
    )
  })

  it("never leaves the Run button held when the download throws", async () => {
    store.nodes = [link("src"), node("run")]
    store.edges = [edge("src", "run")]
    ensureVideoLinksDownloaded.mockRejectedValue(new Error("boom"))
    const setIsRunning = vi.fn()
    expect(await ensureVideoLinksBeforeRun(["run"], setIsRunning)).toBe(false)
    expect(setIsRunning).toHaveBeenLastCalledWith(false)
    expect(toastApi.dismiss).toHaveBeenCalledWith("toast-1")
  })
})

// A run that stops for a long video must say how long it is, where to choose
// the part, and how long a part the next node reads — the person must never
// have to guess (owner feedback, 2026-10-02).
describe("the choose-a-part message", () => {
  const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
  const long = (sec: number | null) => link("src", { youtubeUrl: YT, needsRangeChoice: true, videoDurationSec: sec })

  it("too long for Video Analysis: the length, the limit and what costs the least", () => {
    const nodes = [long(1159), node("va", "video-analysis")]
    const msg = choosePartMessage("src", "Post link", nodes as never, [edge("src", "va")] as never)
    expect(msg.title).toBe(en("run.videoLinkChooseTooLong", { label: "Post link", duration: "19:19", consumer: "Video Analysis", max: "10:00" }))
    expect(msg.description).toBe(en("run.videoLinkCheapestPart", { consumer: "Video Analysis", cheapest: "1:00" }))
  })

  it("long, but within what the node reads: choose a part or download it all", () => {
    const nodes = [long(300), node("va", "video-analysis")]
    const msg = choosePartMessage("src", "Post link", nodes as never, [edge("src", "va")] as never)
    expect(msg.title).toBe(en("run.videoLinkChooseLong", { label: "Post link", duration: "5:00" }))
    expect(msg.description).toBe(en("run.videoLinkCheapestPart", { consumer: "Video Analysis", cheapest: "1:00" }))
  })

  it("no node with a limit: the length, and no cost line", () => {
    const nodes = [long(1159), node("trim", "trim-video")]
    const msg = choosePartMessage("src", "Talk", nodes as never, [edge("src", "trim")] as never)
    expect(msg).toEqual({ title: en("run.videoLinkChooseLong", { label: "Talk", duration: "19:19" }), description: undefined })
  })

  it("length unknown: the plain message", () => {
    const msg = choosePartMessage("src", "Talk", [long(null)] as never, [] as never)
    expect(msg.title).toBe(en("run.videoLinkChoose", { label: "Talk" }))
  })

  it("stays up long enough to use, and its Show button points the canvas at the node", async () => {
    store.nodes = [long(1159), node("va", "video-analysis")]
    store.edges = [edge("src", "va")]
    ensureVideoLinksDownloaded.mockResolvedValue({ ok: false, nodeId: "src", label: "Post link", reason: "choose" })
    expect(await ensureVideoLinksBeforeRun(["va"], vi.fn())).toBe(false)

    const options = toastApi.error.mock.calls[0][1]
    expect(options?.duration).toBe(CHOOSE_PART_TOAST_MS)
    expect(options?.action?.label).toBe(en("common.show"))

    const seen: unknown[] = []
    const listener = (event: Event) => seen.push((event as CustomEvent).detail)
    window.addEventListener(FOCUS_NODES_EVENT, listener)
    options?.action?.onClick()
    window.removeEventListener(FOCUS_NODES_EVENT, listener)
    expect(seen).toEqual([{ nodeIds: ["src"] }])
  })
})
