// The download block the Video URL node's card AND its settings panel share.
// One component, so the two surfaces cannot drift again: the card used to know
// about downloads the panel did not, and neither downloaded YouTube at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

const ingestVideoLink = vi.fn().mockResolvedValue({ status: "completed", videoUrl: "v.mp4" })
const retryVideoLinkIngest = vi.fn().mockResolvedValue({ status: "completed", videoUrl: "v.mp4" })
const resumeVideoLinkIngest = vi.fn()
vi.mock("@/lib/video-link-ingest", () => ({
  ingestVideoLink: (...a: unknown[]) => ingestVideoLink(...a),
  retryVideoLinkIngest: (...a: unknown[]) => retryVideoLinkIngest(...a),
  resumeVideoLinkIngest: (...a: unknown[]) => resumeVideoLinkIngest(...a),
}))

const canvas: { isReadOnly: boolean; nodes: unknown[]; edges: unknown[] } = { isReadOnly: false, nodes: [], edges: [] }
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: typeof canvas) => unknown) => selector(canvas),
}))

import { VideoLinkStatus } from "../video-link-status"
import type { YouTubeVideoData } from "@/types/nodes"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const TIKTOK = "https://www.tiktok.com/@someone/video/7676964064458738952"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

/** A whole node-data object — the fields under test over the node's defaults. */
function nodeData(data: Record<string, unknown>): YouTubeVideoData {
  return { label: "Video URL", youtubeUrl: "", videoId: "", title: "", thumbnailUrl: "", ...data }
}

function renderStatus(data: Record<string, unknown>, variant: "card" | "panel" = "card") {
  return render(<VideoLinkStatus nodeId="n1" data={nodeData(data)} variant={variant} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  canvas.isReadOnly = false
  canvas.nodes = []
  canvas.edges = []
})

/** Wire this Video URL node (n1) into a node of `type`, as the canvas would. */
function feeds(type: string) {
  canvas.nodes = [{ id: "n1", type: "youtube-video", data: {} }, { id: "c1", type, data: { label: "x" } }]
  canvas.edges = [{ id: "e1", source: "n1", target: "c1", sourceHandle: "video", targetHandle: "video" }]
}

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("VideoLinkStatus", () => {
  it("renders nothing for an empty node or a direct file link", () => {
    expect(renderStatus({ youtubeUrl: "" }).container).toBeEmptyDOMElement()
    cleanup()
    expect(renderStatus({ youtubeUrl: FILE }).container).toBeEmptyDOMElement()
  })

  it("offers the download on a link nobody fetched yet — YouTube included", () => {
    renderStatus({ youtubeUrl: YT })
    expect(screen.getByText(en("node.notDownloaded"))).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: en("inputcfg.downloadVideo") }))
    expect(ingestVideoLink).toHaveBeenCalledWith("n1", { mode: "auto" })
  })

  it("shows the live progress with the phase's own words", () => {
    renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadPercent: 41, downloadPhase: "uploading" })
    expect(screen.getByText(en("inputcfg.uploading"))).toBeInTheDocument()
    expect(screen.getByText("41%")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "41")
  })

  it("says it is checking while the length is read", () => {
    renderStatus({ youtubeUrl: YT, downloadStatus: "checking" })
    expect(screen.getByText(en("videolink.checking"))).toBeInTheDocument()
  })

  it("re-attaches a download that lost its reader — and leaves settled states alone", () => {
    renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9" })
    expect(resumeVideoLinkIngest).toHaveBeenCalledWith("n1")
    cleanup()
    resumeVideoLinkIngest.mockClear()
    renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "failed" })
    renderStatus({ youtubeUrl: YT })
    expect(resumeVideoLinkIngest).not.toHaveBeenCalled()
  })

  describe("a long video", () => {
    const LONG = { youtubeUrl: YT, needsRangeChoice: true, videoDurationSec: 5530 }

    it("names the length and downloads the chosen part", () => {
      renderStatus(LONG, "panel")
      expect(screen.getByText(en("videolink.longVideo", { duration: "1:32:10" }))).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText(en("videolink.from")), { target: { value: "0:30" } })
      fireEvent.change(screen.getByLabelText(en("videolink.to")), { target: { value: "1:35" } })
      fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadPart") }))
      expect(ingestVideoLink).toHaveBeenCalledWith("n1", { mode: "section", section: { startSec: 30, endSec: 95 }, force: false })
    })

    it("downloads all of it when asked", () => {
      renderStatus(LONG)
      fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadWhole") }))
      expect(ingestVideoLink).toHaveBeenCalledWith("n1", { mode: "whole", force: false })
    })

    it("refuses a part that makes no sense, and says why — without a request", () => {
      renderStatus(LONG)
      fireEvent.change(screen.getByLabelText(en("videolink.from")), { target: { value: "2:00" } })
      fireEvent.change(screen.getByLabelText(en("videolink.to")), { target: { value: "1:00" } })
      fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadPart") }))
      expect(screen.getByText(en("videolink.rangeOrder"))).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText(en("videolink.to")), { target: { value: "9:99:99" } })
      fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadPart") }))
      expect(screen.getByText(en("videolink.rangeFormat"))).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText(en("videolink.to")), { target: { value: "2:00:00" } })
      fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadPart") }))
      expect(screen.getByText(en("videolink.rangeBeyond", { duration: "1:32:10" }))).toBeInTheDocument()
      expect(ingestVideoLink).not.toHaveBeenCalled()
    })

    it("says so when the length could not be read", () => {
      renderStatus({ youtubeUrl: YT, needsRangeChoice: true, videoDurationSec: null })
      expect(screen.getByText(en("videolink.unknownLength"))).toBeInTheDocument()
    })

    // The person must not have to guess how long a part may be: when the video
    // feeds a node with a length limit, the chooser says it, never offers a
    // whole video that node cannot read, and refuses a longer part up front.
    describe("feeding a node with a length limit (Video Analysis reads up to 10:00)", () => {
      const limitLine = en("videolink.limit", { consumer: "Video Analysis", max: "10:00", cheapest: "1:00" })

      it("says how long a part may be and what costs the least", () => {
        feeds("video-analysis")
        renderStatus(LONG)
        expect(screen.getByText(limitLine)).toBeInTheDocument()
      })

      it("does not offer the whole video when it is longer than the node reads", () => {
        feeds("video-analysis")
        renderStatus(LONG)
        expect(screen.queryByRole("button", { name: en("videolink.downloadWhole") })).toBeNull()
      })

      it("still offers the whole video when it fits", () => {
        feeds("video-analysis")
        renderStatus({ youtubeUrl: YT, needsRangeChoice: true, videoDurationSec: 300 })
        expect(screen.getByRole("button", { name: en("videolink.downloadWhole") })).toBeInTheDocument()
      })

      it("refuses a part longer than the node reads — without a request", () => {
        feeds("video-analysis")
        renderStatus(LONG)
        fireEvent.change(screen.getByLabelText(en("videolink.to")), { target: { value: "12:00" } })
        fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadPart") }))
        expect(screen.getByText(en("videolink.rangeTooLong", { consumer: "Video Analysis", max: "10:00" }))).toBeInTheDocument()
        expect(ingestVideoLink).not.toHaveBeenCalled()
      })

      it("starts on the part that costs the least", () => {
        feeds("video-analysis")
        renderStatus(LONG)
        expect(screen.getByLabelText(en("videolink.to"))).toHaveValue("1:00")
      })

      it("says nothing about limits when the node after it has none", () => {
        feeds("content-recipe")
        renderStatus(LONG)
        expect(screen.queryByText(limitLine)).toBeNull()
        expect(screen.getByRole("button", { name: en("videolink.downloadWhole") })).toBeInTheDocument()
      })
    })
  })

  describe("a failed download", () => {
    it("shows the friendly reason, keeps the server's words as the tooltip, and retries the same request", () => {
      renderStatus({
        youtubeUrl: TIKTOK,
        downloadStatus: "failed",
        downloadErrorCode: "private",
        downloadError: "ERROR: [TikTok] 1: Private video",
      })
      const message = screen.getByText(en("videolink.errorPrivate"))
      expect(message).toHaveAttribute("title", "ERROR: [TikTok] 1: Private video")
      fireEvent.click(screen.getByRole("button", { name: en("inputcfg.retryDownload") }))
      expect(retryVideoLinkIngest).toHaveBeenCalledWith("n1")
      expect(screen.queryByRole("button", { name: en("videolink.downloadSilent") })).toBeNull()
    })

    it("offers the silent download ONLY after a no-audio failure", () => {
      renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "failed", downloadErrorCode: "no_audio" })
      fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadSilent") }))
      expect(retryVideoLinkIngest).toHaveBeenCalledWith("n1", { allowSilent: true })
    })
  })

  describe("a downloaded video", () => {
    it("says ready, and which part when it is one", () => {
      renderStatus({ youtubeUrl: TIKTOK, downloadedVideoUrl: FILE, downloadedFromUrl: TIKTOK }, "panel")
      expect(screen.getByText(en("inputcfg.downloadedAndReady"))).toBeInTheDocument()
      cleanup()
      renderStatus({
        youtubeUrl: YT,
        downloadedVideoUrl: FILE,
        downloadedFromUrl: YT,
        downloadedSection: { startSec: 30, endSec: 95 },
      }, "panel")
      expect(screen.getByText(en("videolink.partReady", { from: "0:30", to: "1:35" }))).toBeInTheDocument()
    })

    it("lets a YouTube video be fetched again as a different part — forced, since a file is already there", () => {
      renderStatus({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT, videoDurationSec: 5530 }, "panel")
      fireEvent.click(screen.getByRole("button", { name: en("videolink.choosePart") }))
      fireEvent.change(screen.getByLabelText(en("videolink.from")), { target: { value: "10" } })
      fireEvent.change(screen.getByLabelText(en("videolink.to")), { target: { value: "20" } })
      fireEvent.click(screen.getByRole("button", { name: en("videolink.downloadPart") }))
      expect(ingestVideoLink).toHaveBeenCalledWith("n1", { mode: "section", section: { startSec: 10, endSec: 20 }, force: true })
    })

    it("can back out of choosing another part", () => {
      renderStatus({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT }, "panel")
      fireEvent.click(screen.getByRole("button", { name: en("videolink.choosePart") }))
      fireEvent.click(screen.getByRole("button", { name: en("videolink.cancel") }))
      expect(screen.getByText(en("inputcfg.downloadedAndReady"))).toBeInTheDocument()
    })

    it("does not offer parts on a TikTok clip — there is nothing to cut", () => {
      renderStatus({ youtubeUrl: TIKTOK, downloadedVideoUrl: FILE, downloadedFromUrl: TIKTOK }, "panel")
      expect(screen.queryByRole("button", { name: en("videolink.choosePart") })).toBeNull()
    })
  })

  it("re-checks a node that STAYS in flight when its link or its download id changes under it", () => {
    const { rerender } = renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9" })
    expect(resumeVideoLinkIngest).toHaveBeenCalledTimes(1)
    // An edit from outside the editor: a new link, status still "downloading".
    rerender(<VideoLinkStatus nodeId="n1" data={nodeData({ youtubeUrl: YT, downloadStatus: "downloading", downloadId: "dl-9" })} variant="card" />)
    expect(resumeVideoLinkIngest).toHaveBeenCalledTimes(2)
    // The same props again change nothing.
    rerender(<VideoLinkStatus nodeId="n1" data={nodeData({ youtubeUrl: YT, downloadStatus: "downloading", downloadId: "dl-9" })} variant="card" />)
    expect(resumeVideoLinkIngest).toHaveBeenCalledTimes(2)
  })

  describe("on a canvas that takes no writes", () => {
    beforeEach(() => {
      canvas.isReadOnly = true
    })

    it("never shows a spinner that cannot end, and never touches the download", () => {
      renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "downloading", downloadId: "dl-9", downloadPercent: 40 })
      expect(screen.getByText(en("node.notDownloaded"))).toBeInTheDocument()
      expect(screen.queryByRole("progressbar")).toBeNull()
      expect(screen.queryByRole("button")).toBeNull()
      expect(resumeVideoLinkIngest).not.toHaveBeenCalled()
    })

    it("offers no button that could not work — not Download, not Retry, not another part", () => {
      renderStatus({ youtubeUrl: YT })
      renderStatus({ youtubeUrl: YT, needsRangeChoice: true })
      renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "failed", downloadErrorCode: "no_audio" })
      renderStatus({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT }, "panel")
      expect(screen.queryByRole("button")).toBeNull()
      // What IS true is still said.
      expect(screen.getByText(en("videolink.errorNoAudio"))).toBeInTheDocument()
      expect(screen.getByText(en("inputcfg.downloadedAndReady"))).toBeInTheDocument()
    })
  })

  it("renders data an agent wrote as junk instead of throwing", () => {
    expect(renderStatus({ youtubeUrl: 5 }).container).toBeEmptyDOMElement()
    cleanup()
    renderStatus({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT, downloadedSection: "0-10" }, "panel")
    expect(screen.getByText(en("inputcfg.downloadedAndReady"))).toBeInTheDocument()
    cleanup()
    renderStatus({ youtubeUrl: TIKTOK, downloadStatus: "failed", downloadError: { not: "text" } })
    expect(screen.getByText(en("videolink.errorGeneric"))).not.toHaveAttribute("title")
  })

  it("follows a live language switch", () => {
    renderStatus({ youtubeUrl: YT })
    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByRole("button", { name: translate("he", "inputcfg.downloadVideo") })).toBeInTheDocument()
  })

  it("keeps a click on the card from reaching the canvas", () => {
    const onCanvasMouseDown = vi.fn()
    render(
      <div onMouseDown={onCanvasMouseDown}>
        <VideoLinkStatus nodeId="n1" data={nodeData({ youtubeUrl: YT, needsRangeChoice: true })} variant="card" />
      </div>,
    )
    fireEvent.mouseDown(screen.getByLabelText(en("videolink.from")))
    expect(onCanvasMouseDown).not.toHaveBeenCalled()
  })
})
