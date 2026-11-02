import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => {
  const state = { nodes: [], edges: [], updateNodeData: (...a: unknown[]) => updateNodeData(...a) }
  const useWorkflowStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state })
  return { useWorkflowStore }
})

const downloadVideoLink = vi.fn()
vi.mock("@/lib/video-link-download", () => ({
  downloadVideoLink: (...a: unknown[]) => downloadVideoLink(...a),
}))

const downloadYouTubeAudio = vi.fn()
vi.mock("@/lib/api", () => ({
  downloadYouTubeAudio: (...a: unknown[]) => downloadYouTubeAudio(...a),
}))

// The content rights declaration (`lib/content-rights.ts`): read once, one confirmation per download.
const { confirmLink, DeclarationChangedError } = vi.hoisted(() => ({
  confirmLink: vi.fn(),
  DeclarationChangedError: class DeclarationChangedError extends Error {},
}))
vi.mock("@/lib/content-rights", () => ({
  confirmLink: (...a: unknown[]) => confirmLink(...a),
  DeclarationChangedError,
  useRightsDeclaration: () => ({ status: "ready", declaration: { version: 1, text: "I hold the rights to this content." } }),
  reloadDeclaration: vi.fn(),
}))

import { VideoLinkInputCard } from "../input-cards/video-link-input-card"
import { clearVideoLinkRights, isVideoLinkRightsTicked } from "@/lib/video-link-rights"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const TIKTOK = "https://www.tiktok.com/@someone/video/7676964064458738952"
const FILE_LINK = "https://cdn.example.com/episodes/ep-12.mp4"
const DOWNLOADED = "https://cdn.nodaro.ai/videos/yt-1.mp4"
const CONFIRMATION = { id: "conf-1", declarationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" }
const AUTO = { mode: "auto", confirmationId: "conf-1" }

type Hooks = { onEvent(e: unknown): void; signal: AbortSignal }

function setup(opts: {
  data?: Record<string, unknown>
  values?: Record<string, unknown>
  readOnly?: boolean
  isFullscreen?: boolean
  nodes?: Array<{ id: string; type?: string; data: Record<string, unknown> }>
  edges?: Array<{ source: string; target: string }>
} = {}) {
  const onUpdateInput = vi.fn()
  const view = (values: Record<string, unknown> | undefined) => (
    <VideoLinkInputCard
      nodeId="v1"
      label="Episode"
      data={opts.data ?? { label: "Episode", youtubeUrl: "https://youtu.be/AAAAAAAAAAA" }}
      isFullscreen={opts.isFullscreen ?? true}
      inputValues={values ? { v1: values } : {}}
      onUpdateInput={onUpdateInput}
      readOnly={opts.readOnly}
      nodes={opts.nodes}
      edges={opts.edges}
    />
  )
  const utils = render(view(opts.values ?? { youtubeUrl: "" }))
  return { ...utils, onUpdateInput, rerender: (values: Record<string, unknown>) => utils.rerender(view(values)) }
}

const input = () => screen.getByPlaceholderText("Paste a video link") as HTMLInputElement
const written = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map(([, key, value]) => [key, value])
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(800) }) }
/** The content rights box, ticked by the runner for the link in the field. */
const box = () => screen.getByRole("checkbox", { name: "I confirm this declaration for this link" })
const tick = async () => { await act(async () => { fireEvent.click(box()) }) }
/** What the card wrote for the link change: the link, and every field of the old link's dropped. */
const linkChange = (link: string) => [["youtubeUrl", link], ["downloadedVideoUrl", undefined], ["downloadedFromUrl", undefined]]

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  clearVideoLinkRights()
  downloadVideoLink.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
  downloadYouTubeAudio.mockResolvedValue({ url: "https://cdn.nodaro.ai/audios/yt-1.mp3", thumbnailUrl: null })
  confirmLink.mockResolvedValue(CONFIRMATION)
})
afterEach(() => vi.useRealTimers())

describe("the Video URL app input card", () => {
  it("shows the name, the empty field and what it takes", () => {
    setup()
    expect(screen.getByText("Episode")).toBeInTheDocument()
    expect(input().value).toBe("")
    expect(screen.getByText(/A link to where your video is/)).toBeInTheDocument()
  })

  it("a direct file link is written as it is: nothing is downloaded, and any earlier file is cleared", async () => {
    const { onUpdateInput } = setup()
    fireEvent.change(input(), { target: { value: `  ${FILE_LINK} ` } })
    expect(written(onUpdateInput)).toEqual(linkChange(FILE_LINK))
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled()
    // Nothing is imported from a file link: no box to tick.
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("says so when a file link is in the field", () => {
    setup({ values: { youtubeUrl: FILE_LINK } })
    expect(screen.getByText("Direct link — used as it is")).toBeInTheDocument()
  })

  it("an invalid link shows an alert, marks the field, and never downloads", async () => {
    setup({ values: { youtubeUrl: "not a link" } })
    expect(screen.getByRole("alert")).toHaveTextContent("That link can't be used")
    expect(input()).toHaveAttribute("aria-invalid", "true")
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled()
  })

  it("any other web link is a direct link, as on the canvas (no extension needed)", async () => {
    setup({ values: { youtubeUrl: "https://example.com/stream/ep-12" } })
    expect(screen.getByText("Direct link — used as it is")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled()
  })

  it("a host with no video in the address is invalid too", () => {
    setup({ values: { youtubeUrl: "https://www.youtube.com/" } })
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })

  it("a post link downloads on its own once the box is ticked and the typing stops, then writes the file BOUND to the link", async () => {
    const { onUpdateInput } = setup({ values: { youtubeUrl: TIKTOK } })
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled() // the box
    expect(screen.getByText("Confirm the declaration to fetch this video.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Download Video" })).toBeDisabled()
    await tick()
    expect(downloadVideoLink).not.toHaveBeenCalled() // the pause
    await flush()
    // Under a confirmation of its own, with a fresh one for the one restart.
    expect(downloadVideoLink).toHaveBeenCalledWith(TIKTOK, AUTO, expect.objectContaining({ refreshConfirmation: expect.any(Function) }))
    expect(confirmLink).toHaveBeenCalledWith(TIKTOK)
    expect(written(onUpdateInput)).toEqual([["downloadedVideoUrl", DOWNLOADED], ["downloadedFromUrl", TIKTOK]])
  })

  it("a confirmation the server refuses is a rights failure, shown like any other; a changed declaration unticks the box as well", async () => {
    confirmLink.mockRejectedValueOnce(new Error("Authentication required"))
    setup({ values: { youtubeUrl: TIKTOK } })
    await tick()
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("didn't go through")
    expect(box()).toHaveAttribute("data-state", "checked")

    confirmLink.mockRejectedValueOnce(new DeclarationChangedError("changed"))
    fireEvent.click(screen.getByText("Retry Download"))
    await flush()
    expect(box()).toHaveAttribute("data-state", "unchecked")
  })

  it("the box is the session's: nothing of it is written to the run's inputs", async () => {
    const { onUpdateInput } = setup({ values: { youtubeUrl: TIKTOK } })
    await tick()
    await tick()
    expect(onUpdateInput).not.toHaveBeenCalled()
    expect(isVideoLinkRightsTicked("v1", TIKTOK)).toBe(false)
  })

  it("unticking the box stops a new download from starting; editing the link unticks it", async () => {
    const { rerender } = setup({ values: { youtubeUrl: TIKTOK } })
    await tick()
    expect(box()).toHaveAttribute("data-state", "checked")
    await tick()
    expect(box()).toHaveAttribute("data-state", "unchecked")
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled()

    await tick()
    rerender({ youtubeUrl: "https://www.tiktok.com/@someone/video/1111111111111111111" })
    expect(box()).toHaveAttribute("data-state", "unchecked")
  })

  it("never starts a download for a link that already has its file — and shows no box, nothing being left to import", async () => {
    setup({ values: { youtubeUrl: TIKTOK, downloadedVideoUrl: DOWNLOADED, downloadedFromUrl: TIKTOK } })
    expect(screen.getByText("Downloaded and ready")).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).toBeNull()
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled()
  })

  it("untouched in the creator's view, it shows the creator's sample as ready", async () => {
    setup({
      isFullscreen: false,
      data: { youtubeUrl: TIKTOK, downloadedVideoUrl: DOWNLOADED, downloadedFromUrl: TIKTOK },
    })
    expect(input().value).toBe(TIKTOK)
    expect(screen.getByText("Downloaded and ready")).toBeInTheDocument()
  })

  it("on the canvas preview (not the runner) it writes to the node, not to the run's inputs", () => {
    const { onUpdateInput } = setup({ isFullscreen: false, data: { youtubeUrl: "" } })
    fireEvent.change(input(), { target: { value: FILE_LINK } })
    expect(onUpdateInput).not.toHaveBeenCalled()
    expect(updateNodeData).toHaveBeenCalledWith("v1", {
      youtubeUrl: FILE_LINK,
      downloadedVideoUrl: undefined,
      downloadedFromUrl: undefined,
      // On the canvas the node itself carries the sound Transcribe / Suno Cover read.
      downloadedAudioUrl: undefined,
      audioDownloadStatus: undefined,
    })
  })

  it("shows the progress of a download as it runs, and holds the box meanwhile", async () => {
    let hooks!: Hooks
    downloadVideoLink.mockImplementation((_u: string, _r: unknown, h: Hooks) => {
      hooks = h
      return new Promise(() => {})
    })
    setup({ values: { youtubeUrl: TIKTOK } })
    await tick()
    await flush()
    act(() => hooks.onEvent({ kind: "progress", percent: 42, phase: "downloading" }))
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42")
    expect(screen.getByText("42%")).toBeInTheDocument()
    expect(box()).toBeDisabled()
  })

  it("a long YouTube video asks for a part: a bad range is explained, a good one downloads exactly that part", async () => {
    downloadVideoLink.mockResolvedValueOnce({ status: "needs-choice", durationSec: 5530 })
    const { onUpdateInput } = setup({ values: { youtubeUrl: YT } })
    await tick()
    await flush()
    expect(screen.getByText(/This video is 1:32:10 long/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "soon" } })
    fireEvent.click(screen.getByText("Download this part"))
    expect(screen.getByRole("alert")).toHaveTextContent("Use a time like 1:30")
    expect(downloadVideoLink).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "10:00" } })
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "20:00" } })
    fireEvent.click(screen.getByText("Download this part"))
    await flush()
    expect(downloadVideoLink).toHaveBeenLastCalledWith(YT, { mode: "section", section: { startSec: 600, endSec: 1200 }, confirmationId: "conf-1" }, expect.anything())
    expect(written(onUpdateInput)).toContainEqual(["downloadedFromUrl", YT])
  })

  it("offers the whole video when the nodes after it can read it, and says how long they read when not", async () => {
    downloadVideoLink.mockResolvedValue({ status: "needs-choice", durationSec: 5530 })
    setup({
      values: { youtubeUrl: YT },
      nodes: [{ id: "v1", type: "youtube-video", data: {} }, { id: "a1", type: "video-analysis", data: {} }],
      edges: [{ source: "v1", target: "a1" }],
    })
    await tick()
    await flush()
    // Video Analysis reads up to a limit shorter than a 92-minute episode: no "whole video" button.
    expect(screen.queryByText("Download whole video")).not.toBeInTheDocument()
    expect(screen.getByText(/reads up to/)).toBeInTheDocument()
  })

  it("a long video with nothing limiting it can be taken whole", async () => {
    downloadVideoLink.mockResolvedValueOnce({ status: "needs-choice", durationSec: 5530 })
    setup({ values: { youtubeUrl: YT } })
    await tick()
    await flush()
    fireEvent.click(screen.getByText("Download whole video"))
    await flush()
    expect(downloadVideoLink).toHaveBeenLastCalledWith(YT, { mode: "whole", confirmationId: "conf-1" }, expect.anything())
  })

  it("a failed download says why in plain words and can be retried; no-sound offers the silent retry", async () => {
    downloadVideoLink.mockResolvedValueOnce({ status: "failed", code: "no_audio", raw: "no audio track" })
    setup({ values: { youtubeUrl: TIKTOK } })
    await tick()
    await flush()
    expect(screen.getByRole("alert")).toHaveTextContent("came through without its sound")
    fireEvent.click(screen.getByText("Download without sound"))
    await flush()
    expect(downloadVideoLink).toHaveBeenLastCalledWith(TIKTOK, { mode: "auto", allowSilent: true, confirmationId: "conf-1" }, expect.anything())
  })

  it("editing the link cancels the download in flight and drops what it brings", async () => {
    let hooks!: Hooks
    let finish!: (v: unknown) => void
    downloadVideoLink.mockImplementation((_u: string, _r: unknown, h: Hooks) => {
      hooks = h
      return new Promise((resolve) => { finish = resolve })
    })
    const { onUpdateInput, rerender } = setup({ values: { youtubeUrl: TIKTOK } })
    await tick()
    await flush()
    rerender({ youtubeUrl: "https://www.tiktok.com/@someone/video/1111111111111111111" })
    expect(hooks.signal.aborted).toBe(true)
    await act(async () => { finish({ status: "completed", videoUrl: DOWNLOADED }) })
    expect(written(onUpdateInput).filter(([k]) => k === "downloadedVideoUrl")).toEqual([])
  })

  it("a page that takes no writes shows the link, no box, and downloads nothing", async () => {
    const { onUpdateInput } = setup({ values: { youtubeUrl: TIKTOK }, readOnly: true })
    expect(input()).toBeDisabled()
    expect(screen.queryByRole("checkbox")).toBeNull()
    await flush()
    expect(downloadVideoLink).not.toHaveBeenCalled()
    expect(onUpdateInput).not.toHaveBeenCalled()
  })

  it("the clear button empties the field", () => {
    const { onUpdateInput } = setup({ values: { youtubeUrl: FILE_LINK } })
    fireEvent.click(screen.getByLabelText("Remove"))
    expect(written(onUpdateInput)[0]).toEqual(["youtubeUrl", ""])
  })

  // Decided 2026-10-08: audio only when every node after the link is audio-only, as the editor does.
  describe("what the nodes after the link read", () => {
    const graph = (...consumers: string[]) => ({
      nodes: [{ id: "v1", type: "youtube-video", data: {} }, ...consumers.map((type, i) => ({ id: `c${i}`, type, data: {} }))],
      edges: consumers.map((_, i) => ({ source: "v1", target: `c${i}` })),
    })

    it("only Transcribe after it: no video is fetched and no part is asked for — the box is ticked for the link, and the run confirms it when pressed", async () => {
      downloadVideoLink.mockResolvedValue({ status: "needs-choice", durationSec: 5530 })
      const { onUpdateInput } = setup({ values: { youtubeUrl: YT }, ...graph("transcribe") })
      await tick()
      await flush()
      expect(downloadVideoLink).not.toHaveBeenCalled()
      expect(screen.queryByText(/This video is/)).not.toBeInTheDocument()
      expect(screen.getByText(/Only the sound of this video is used/)).toBeInTheDocument()
      // Nothing is confirmed, nothing is written: Run confirms the link for its own request.
      expect(confirmLink).not.toHaveBeenCalled()
      expect(onUpdateInput).not.toHaveBeenCalled()
      expect(isVideoLinkRightsTicked("v1", YT)).toBe(true)
    })

    it("a changed link is another box, unticked", async () => {
      const { rerender } = setup({ values: { youtubeUrl: YT }, ...graph("transcribe") })
      await tick()
      rerender({ youtubeUrl: TIKTOK })
      expect(box()).toHaveAttribute("data-state", "unchecked")
      expect(isVideoLinkRightsTicked("v1", TIKTOK)).toBe(false)
    })

    it("a link whose track is stored for it shows no box: nothing is left to import", async () => {
      setup({ values: { youtubeUrl: YT, downloadedAudioUrl: "https://cdn.nodaro.ai/audios/have.mp3" }, ...graph("transcribe") })
      await flush()
      expect(screen.queryByRole("checkbox")).toBeNull()
    })

    it("a node that watches the video beside Transcribe still downloads the video", async () => {
      setup({ values: { youtubeUrl: TIKTOK }, ...graph("transcribe", "video-analysis") })
      await tick()
      await flush()
      expect(downloadVideoLink).toHaveBeenCalledWith(TIKTOK, AUTO, expect.anything())
    })

    it("only nodes that take the page link (Dubbing): nothing is fetched, no audio note and no box", async () => {
      setup({ values: { youtubeUrl: TIKTOK }, ...graph("dubbing") })
      await flush()
      expect(downloadVideoLink).not.toHaveBeenCalled()
      expect(screen.queryByText(/Only the sound of this video is used/)).not.toBeInTheDocument()
      expect(screen.queryByRole("checkbox")).toBeNull()
    })

    // The canvas preview writes to the node itself, and on the canvas a Transcribe-only graph skips
    // the video on Run and reads the node's own audio track — so the preview has to fetch that track.
    it("on the canvas preview, a link read only for its sound gets its audio track fetched into the node once the box is ticked", async () => {
      setup({ isFullscreen: false, data: { label: "Episode", youtubeUrl: TIKTOK }, ...graph("transcribe") })
      await flush()
      expect(downloadYouTubeAudio).not.toHaveBeenCalled()
      await tick()
      await flush()
      expect(downloadVideoLink).not.toHaveBeenCalled()
      expect(downloadYouTubeAudio).toHaveBeenCalledWith(TIKTOK, { confirmationId: "conf-1" })
      expect(updateNodeData).toHaveBeenCalledWith("v1", { downloadedAudioUrl: "https://cdn.nodaro.ai/audios/yt-1.mp3", audioDownloadStatus: "completed" })
      // The box is the session's: nothing of it is written to the node.
      expect(updateNodeData).not.toHaveBeenCalledWith("v1", expect.objectContaining({ rightsConfirmationId: expect.anything() }))
    })

    it("on the canvas preview, a changed declaration unticks the box and records the failure on the node", async () => {
      confirmLink.mockRejectedValueOnce(new DeclarationChangedError("changed"))
      setup({ isFullscreen: false, data: { label: "Episode", youtubeUrl: TIKTOK }, ...graph("transcribe") })
      await tick()
      await flush()
      expect(downloadYouTubeAudio).not.toHaveBeenCalled()
      expect(updateNodeData).toHaveBeenCalledWith("v1", { audioDownloadStatus: "failed", audioDownloadError: "changed" })
      expect(isVideoLinkRightsTicked("v1", TIKTOK)).toBe(false)
    })

    it("…but not when the node already holds its track (no box either), nor in the runner (the server fetches the sound there)", async () => {
      setup({ isFullscreen: false, data: { label: "Episode", youtubeUrl: TIKTOK, downloadedAudioUrl: "https://cdn.nodaro.ai/audios/have.mp3" }, ...graph("transcribe") })
      expect(screen.queryByRole("checkbox")).toBeNull()
      await flush()
      expect(downloadYouTubeAudio).not.toHaveBeenCalled()

      setup({ isFullscreen: true, values: { youtubeUrl: TIKTOK }, ...graph("transcribe") })
      await flush()
      expect(downloadYouTubeAudio).not.toHaveBeenCalled()
    })

    it("on the canvas preview, an audio failure is recorded on the node, never thrown", async () => {
      downloadYouTubeAudio.mockRejectedValueOnce(new Error("nope"))
      setup({ isFullscreen: false, data: { label: "Episode", youtubeUrl: TIKTOK }, ...graph("transcribe") })
      await tick()
      await flush()
      expect(updateNodeData).toHaveBeenCalledWith("v1", { audioDownloadStatus: "failed", audioDownloadError: "nope" })
    })

    it("a link that feeds nothing in the graph is treated as a video (the safe default)", async () => {
      setup({ values: { youtubeUrl: TIKTOK }, nodes: [{ id: "v1", type: "youtube-video", data: {} }], edges: [] })
      await tick()
      await flush()
      expect(downloadVideoLink).toHaveBeenCalled()
    })
  })
})
