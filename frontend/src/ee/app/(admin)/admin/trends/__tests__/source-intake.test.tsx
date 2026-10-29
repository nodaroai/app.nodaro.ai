/**
 * Admin → Trends → a new source clip on a build WITH the shared media editor
 * (`virtual:media-editor` mocked here with small stand-ins for its parts).
 *
 * - Upload, a library video's address and a link (YouTube, TikTok, Instagram,
 *   X, Facebook) all lead to the clip's range (4–30 s) and shape before it is
 *   stored; a clip over 30 s opens on its first 30 s.
 * - A YouTube video's part is picked on its embed and only that part is
 *   downloaded (cut exactly); any other link downloads whole.
 * - "Use this clip": the platform cuts it when anything changed (no longer
 *   than 29.9 s), the cut (or the clip as it came) is stored, and only then
 *   are the intake's own files — the cut and a link's download — discarded.
 *   An upload or a library video is never discarded.
 * - Failures are worded by the admin, never in the download's own words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

const fake = vi.hoisted(() => {
  type Range = { start: number; end: number }
  type Size = { width: number; height: number }
  const adapter = (duration: () => number) => ({
    duration,
    currentTime: () => 0,
    seek: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    isPlaying: () => false,
    subscribe: () => () => undefined,
  })
  const ratioOf = (id: string, n: Size) => {
    if (id === "original") return n.width / n.height
    const [w, h] = id.split(":").map(Number)
    return w! / h!
  }
  return {
    adapter,
    /** What the range strip asks the next range change to be. */
    nextRange: { current: { start: 2, end: 10 } as Range },
    trimLimits: [] as Array<{ minSec?: number; maxSec?: number }>,
    fullRect: (n: Size, id: string) => {
      const r = ratioOf(id, n)
      const width = Math.min(n.width, Math.round(n.height * r))
      const height = Math.min(n.height, Math.round(width / r))
      return { x: Math.round((n.width - width) / 2), y: Math.round((n.height - height) / 2), width, height }
    },
  }
})

vi.mock("virtual:media-editor", async () => {
  const { createElement: h } = await import("react")
  type Range = { start: number; end: number }
  return {
    mediaEditorAvailable: true,
    TrimPanel: (p: { range: Range; onRangeChange: (r: Range) => void; minSec?: number; maxSec?: number }): ReactElement => {
      fake.trimLimits.push({ minSec: p.minSec, maxSec: p.maxSec })
      return h(
        "div",
        { "data-testid": "trim" },
        h("span", null, `range ${p.range.start}–${p.range.end}`),
        h("button", { type: "button", onClick: () => p.onRangeChange(fake.nextRange.current) }, "Move the range"),
      )
    },
    CropPanel: (p: { rect: { x: number; y: number; width: number; height: number } }): ReactElement =>
      h("div", { "data-testid": "crop" }, `crop ${p.rect.x},${p.rect.y} ${p.rect.width}x${p.rect.height}`),
    RatioPicker: (p: { ratios: readonly string[]; value: string; onChange: (id: string) => void; disabled?: boolean }): ReactElement =>
      h(
        "div",
        { role: "radiogroup", "aria-label": "Ratio" },
        ...p.ratios.map((id) => h("button", { key: id, type: "button", role: "radio", "aria-checked": id === p.value, disabled: p.disabled, onClick: () => p.onChange(id) }, id)),
      ),
    htmlMediaAdapter: (el: HTMLMediaElement) => fake.adapter(() => el.duration),
    defaultRange: (d: number, max?: number) => ({ start: 0, end: Math.min(d, max ?? d) }),
    clampRange: (r: Range) => r,
    formatTime: (s: number) => `${s.toFixed(1)}s`,
    fullRect: fake.fullRect,
    isWholeFrame: () => false,
  }
})

vi.mock("@/lib/video-link-download", () => ({ downloadVideoLink: vi.fn() }))
vi.mock("../components/uploads", async (orig) => ({
  ...(await orig<typeof import("../components/uploads")>()),
  uploadLocalFile: vi.fn(),
}))
vi.mock("../components/source-intake/youtube-player", () => ({
  useYouTubePlayer: () => ({ status: "ready", player: fake.adapter(() => 120) }),
}))

import { toast } from "sonner"
import { downloadVideoLink } from "@/lib/video-link-download"
import { fetchMock, renderWith, resetRoutes, routes, sentTo, TREND_ID } from "./harness"
import { SourceClipEditor } from "../components/SourceClipEditor"
import { uploadLocalFile } from "../components/uploads"

const BASE = `/v1/admin/trends/${TREND_ID}`
const UPLOADED = "https://cdn.test/u/upload.mp4"
const LIBRARY = "https://cdn.test/u/library.mp4"
const DOWNLOADED = "https://cdn.test/u/downloaded.mp4"
const CUT = "https://cdn.test/u/cut.mp4"
const STORED = "https://cdn.test/trends/a1/stored.mp4"

const download = vi.mocked(downloadVideoLink)
const upload = vi.mocked(uploadLocalFile)

function renderEditor() {
  const onChange = vi.fn()
  renderWith(<SourceClipEditor trendId={TREND_ID} source={null} previewStart={null} onChange={onChange} />)
  return onChange
}

/** The new clip's video, as the browser reads it once its metadata is in. */
function loadVideo({ sec, width = 1920, height = 1080 }: { sec: number; width?: number; height?: number }) {
  const video = within(screen.getByRole("group", { name: "New source clip" })).getByLabelText("The new source clip") as HTMLVideoElement
  Object.defineProperty(video, "duration", { configurable: true, value: sec })
  Object.defineProperty(video, "videoWidth", { configurable: true, value: width })
  Object.defineProperty(video, "videoHeight", { configurable: true, value: height })
  fireEvent.loadedMetadata(video)
  return video
}

/** Every call to the platform and to the mocks, in the order made. */
function order(...calls: Array<{ mock: { invocationCallOrder: number[] } } | number>): number[] {
  return calls.map((c) => (typeof c === "number" ? c : c.mock.invocationCallOrder[0]!))
}
const fetchOrder = (key: string) => {
  const i = fetchMock.mock.calls.findIndex(([url, init]) => `${init?.method ?? "GET"} ${url}` === key)
  return fetchMock.mock.invocationCallOrder[i]!
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  vi.mocked(toast.error).mockClear()
  download.mockReset()
  upload.mockReset()
  fake.trimLimits.length = 0
  fake.nextRange.current = { start: 2, end: 10 }
  routes[`POST ${BASE}/media`] = () => ({ body: { data: { url: STORED, durationSec: 8, width: 1080, height: 1920 } } })
  routes["POST /v1/media/process"] = () => ({ body: { data: { url: CUT, thumbnailUrl: null, assetId: "a1", metadata: {}, sizeBytes: 1, mimeType: "video/mp4" } } })
  routes["POST /v1/media/discard"] = () => ({ body: { data: { discarded: true } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("every source shows its range and shape before it is stored", () => {
  it("an upload cropped to 9:16: cut (crop only, no trim), the cut stored, the cut discarded — never the upload", async () => {
    upload.mockResolvedValue(UPLOADED)
    const onChange = renderEditor()
    const user = userEvent.setup()
    expect(screen.getByRole("button", { name: /get video/i })).toBeInTheDocument()

    await user.upload(screen.getByLabelText("Upload clip"), new File(["x"], "dance.mp4", { type: "video/mp4" }))
    const step = await screen.findByRole("group", { name: "New source clip" })
    expect(within(step).getByText("dance.mp4")).toBeInTheDocument()
    loadVideo({ sec: 12 })
    expect(within(step).getByText("range 0–12")).toBeInTheDocument()
    expect(fake.trimLimits.at(-1)).toEqual({ minSec: 4, maxSec: 30 })
    expect(within(step).getByRole("button", { name: "Use this clip" })).toBeEnabled()

    // The six shapes, Original first; a shape puts the crop box over the video.
    const ratios = within(step).getByRole("radiogroup", { name: "Ratio" })
    expect(within(ratios).getAllByRole("radio").map((r) => r.textContent)).toEqual(["original", "9:16", "16:9", "1:1", "4:3", "3:4"])
    await user.click(within(ratios).getByRole("radio", { name: "9:16" }))
    expect(within(step).getByTestId("crop")).toHaveTextContent("crop 656,0 608x1080")

    await user.click(within(step).getByRole("button", { name: "Cut and use this clip" }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: CUT, kind: "source" }]))
    expect(sentTo("POST /v1/media/process")).toEqual([{ sourceUrl: UPLOADED, type: "video", crop: { x: 656, y: 0, width: 608, height: 1080 } }])
    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toEqual([{ url: CUT }]))
    const [processed, stored, discarded] = [fetchOrder("POST /v1/media/process"), fetchOrder(`POST ${BASE}/media`), fetchOrder("POST /v1/media/discard")]
    expect(processed).toBeLessThan(stored)
    expect(stored).toBeLessThan(discarded)
    await waitFor(() => expect(screen.queryByRole("group", { name: "New source clip" })).not.toBeInTheDocument())
    expect(onChange).toHaveBeenCalledWith({ source: expect.objectContaining({ videoUrl: STORED }), previewStart: null })
  })

  it("a library video kept whole and uncropped is stored as it is: no cut, nothing discarded", async () => {
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Upload clip: URL"), `${LIBRARY}{Enter}`)
    const step = await screen.findByRole("group", { name: "New source clip" })
    expect(sentTo(`POST ${BASE}/media`)).toEqual([])
    loadVideo({ sec: 9.5 })
    await user.click(within(step).getByRole("button", { name: "Use this clip" }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: LIBRARY, kind: "source" }]))
    expect(sentTo("POST /v1/media/process")).toEqual([])
    expect(sentTo("POST /v1/media/discard")).toEqual([])
  })

  it("a clip over 30 s opens on its first 30 s, and its cut is capped at 29.9 s", async () => {
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Upload clip: URL"), `${LIBRARY}{Enter}`)
    const step = await screen.findByRole("group", { name: "New source clip" })
    loadVideo({ sec: 45 })
    expect(within(step).getByText("range 0–30")).toBeInTheDocument()
    expect(within(step).getByText(/longer than 30 s: pick the part to use/)).toBeInTheDocument()
    await user.click(within(step).getByRole("button", { name: "Cut and use this clip" }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: CUT, kind: "source" }]))
    expect(sentTo("POST /v1/media/process")).toEqual([{ sourceUrl: LIBRARY, type: "video", trim: { startTime: 0, endTime: 29.9 } }])
    // The cut is the intake's own; the library video is not.
    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toEqual([{ url: CUT }]))
  })

  it("a clip under 4 s cannot be used: it says so and Use stays off", async () => {
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Upload clip: URL"), `${LIBRARY}{Enter}`)
    const step = await screen.findByRole("group", { name: "New source clip" })
    loadVideo({ sec: 3.2 })
    expect(within(step).getByRole("alert")).toHaveTextContent("This clip is 3.2 s. A source clip must be at least 4 s")
    expect(within(step).getByRole("button", { name: "Use this clip" })).toBeDisabled()
    expect(within(step).queryByTestId("trim")).not.toBeInTheDocument()
  })
})

describe("a link", () => {
  it("TikTok downloads whole; the range picked; cut, stored, then the cut AND the download discarded", async () => {
    download.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.tiktok.com/@a/video/123{Enter}")
    expect(download).toHaveBeenCalledWith("https://www.tiktok.com/@a/video/123", { mode: "whole" }, expect.anything())
    const step = await screen.findByRole("group", { name: "New source clip" })
    expect(within(step).getByText("From TikTok")).toBeInTheDocument()
    loadVideo({ sec: 20 })
    await user.click(within(step).getByRole("button", { name: "Move the range" }))
    expect(within(step).getByText("range 2–10")).toBeInTheDocument()
    await user.click(within(step).getByRole("button", { name: "Cut and use this clip" }))

    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toHaveLength(2))
    expect(sentTo("POST /v1/media/process")).toEqual([{ sourceUrl: DOWNLOADED, type: "video", trim: { startTime: 2, endTime: 10 } }])
    expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: CUT, kind: "source" }])
    expect(sentTo("POST /v1/media/discard")).toEqual(expect.arrayContaining([{ url: CUT }, { url: DOWNLOADED }]))
    const stored = fetchOrder(`POST ${BASE}/media`)
    const discards = fetchMock.mock.calls.flatMap(([url], i) => (url === "/v1/media/discard" ? [fetchMock.mock.invocationCallOrder[i]!] : []))
    for (const at of discards) expect(at).toBeGreaterThan(stored)
    expect(order(download)[0]).toBeLessThan(fetchOrder("POST /v1/media/process"))
  })

  it("a link's download kept whole and uncropped is stored, then discarded (the trend holds its own copy)", async () => {
    download.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.instagram.com/reel/abc{Enter}")
    const step = await screen.findByRole("group", { name: "New source clip" })
    loadVideo({ sec: 15 })
    await user.click(within(step).getByRole("button", { name: "Use this clip" }))
    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toEqual([{ url: DOWNLOADED }]))
    expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: DOWNLOADED, kind: "source" }])
    expect(sentTo("POST /v1/media/process")).toEqual([])
    expect(fetchOrder(`POST ${BASE}/media`)).toBeLessThan(fetchOrder("POST /v1/media/discard"))
  })

  it("a YouTube video: its part is picked on the embed and only that part downloads, cut exactly", async () => {
    routes["POST /v1/video-metadata"] = () => ({ body: { durationSec: 120, title: "Office dance", isLive: false } })
    download.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.youtube.com/watch?v=dQw4w9WgXcQ{Enter}")
    const pick = await screen.findByRole("group", { name: "Pick the part to download" })
    expect(within(pick).getByText("range 0–30")).toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
    fake.nextRange.current = { start: 12.3, end: 20.6 }
    await user.click(within(pick).getByRole("button", { name: "Move the range" }))
    await user.click(within(pick).getByRole("button", { name: "Download this part" }))
    expect(download).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { mode: "section", section: { startSec: 12.3, endSec: 20.6 } }, expect.anything())
    const step = await screen.findByRole("group", { name: "New source clip" })
    expect(within(step).getByText("Office dance")).toBeInTheDocument()
  })

  it("a live YouTube stream is refused before anything downloads", async () => {
    routes["POST /v1/video-metadata"] = () => ({ body: { durationSec: null, title: null, isLive: true } })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://youtu.be/dQw4w9WgXcQ{Enter}")
    expect(await screen.findByRole("alert")).toHaveTextContent("This is a live stream. Use a recorded video.")
    expect(download).not.toHaveBeenCalled()
  })

  it("a link it does not take is said at once, with no request", async () => {
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://vimeo.com/123{Enter}")
    expect(screen.getByRole("alert")).toHaveTextContent("Paste a YouTube, TikTok, Instagram, X or Facebook link.")
    expect(download).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a failed download is worded by its class, never in the download's own words, with Try again", async () => {
    download.mockResolvedValueOnce({ status: "failed", code: "generic", raw: "ERROR: [TikTok] 123: Unable to extract webpage video data" })
    download.mockResolvedValueOnce({ status: "completed", videoUrl: DOWNLOADED })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.tiktok.com/@a/video/123{Enter}")
    expect(await screen.findByRole("alert")).toHaveTextContent("The video could not be downloaded. Check the link and try again.")
    expect(screen.queryByText(/Unable to extract/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("group", { name: "New source clip" })).toBeInTheDocument()
    expect(download).toHaveBeenCalledTimes(2)
  })

  it("a private video says so, with no Try again", async () => {
    download.mockResolvedValue({ status: "failed", code: "private", raw: "Private video. Sign in" })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://x.com/a/status/1{Enter}")
    expect(await screen.findByRole("alert")).toHaveTextContent("This video is private or needs a sign-in. Use a public video.")
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
  })

  it("Cancel on a downloaded clip discards the download; nothing is stored", async () => {
    download.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.facebook.com/reel/77{Enter}")
    const step = await screen.findByRole("group", { name: "New source clip" })
    await user.click(within(step).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toEqual([{ url: DOWNLOADED }]))
    expect(sentTo(`POST ${BASE}/media`)).toEqual([])
    expect(screen.getByRole("button", { name: /get video/i })).toBeInTheDocument()
  })

  it("Cancel on an upload discards nothing", async () => {
    upload.mockResolvedValue(UPLOADED)
    renderEditor()
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText("Upload clip"), new File(["x"], "dance.mp4", { type: "video/mp4" }))
    const step = await screen.findByRole("group", { name: "New source clip" })
    await user.click(within(step).getByRole("button", { name: "Cancel" }))
    expect(sentTo("POST /v1/media/discard")).toEqual([])
  })
})

describe("leaving the page", () => {
  it("while the store copies the cut, nothing is discarded until it answers", async () => {
    let answer: (() => void) | undefined
    routes[`POST ${BASE}/media`] = () =>
      new Promise((resolve) => {
        answer = () => resolve({ body: { data: { url: STORED, durationSec: 8 } } })
      })
    download.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
    const onChange = vi.fn()
    const view = renderWith(<SourceClipEditor trendId={TREND_ID} source={null} previewStart={null} onChange={onChange} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.tiktok.com/@a/video/123{Enter}")
    const step = await screen.findByRole("group", { name: "New source clip" })
    loadVideo({ sec: 20 })
    await user.click(within(step).getByRole("button", { name: "Move the range" }))
    await user.click(within(step).getByRole("button", { name: "Cut and use this clip" }))
    await waitFor(() => expect(answer).toBeDefined())
    view.unmount()
    expect(sentTo("POST /v1/media/discard")).toEqual([])
    answer!()
    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toHaveLength(2))
    expect(fetchOrder(`POST ${BASE}/media`)).toBeLessThan(fetchOrder("POST /v1/media/discard"))
  })

  it("with a downloaded clip open (not confirmed), its download is discarded", async () => {
    download.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
    const view = renderWith(<SourceClipEditor trendId={TREND_ID} source={null} previewStart={null} onChange={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.tiktok.com/@a/video/123{Enter}")
    await screen.findByRole("group", { name: "New source clip" })
    view.unmount()
    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toEqual([{ url: DOWNLOADED }]))
    expect(sentTo(`POST ${BASE}/media`)).toEqual([])
  })
})

describe("refusals while confirming", () => {
  it("a cut that fails is worded by the admin; nothing is stored or discarded, and the clip stays open", async () => {
    routes["POST /v1/media/process"] = () => ({ status: 500, body: { error: { code: "internal", message: "ffmpeg exited with code 1: moov atom not found" } } })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Upload clip: URL"), `${LIBRARY}{Enter}`)
    const step = await screen.findByRole("group", { name: "New source clip" })
    loadVideo({ sec: 20 })
    await user.click(within(step).getByRole("button", { name: "Move the range" }))
    await user.click(within(step).getByRole("button", { name: "Cut and use this clip" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The clip could not be cut. Try again."))
    expect(vi.mocked(toast.error).mock.calls.flat().join(" ")).not.toMatch(/ffmpeg|moov/)
    expect(sentTo(`POST ${BASE}/media`)).toEqual([])
    expect(sentTo("POST /v1/media/discard")).toEqual([])
    expect(screen.getByRole("group", { name: "New source clip" })).toBeInTheDocument()
  })

  it("a store that fails keeps the clip and its cut (nothing discarded); another try stores the same cut without cutting again", async () => {
    let refuse = true
    routes[`POST ${BASE}/media`] = () =>
      refuse ? { status: 422, body: { error: { code: "validation_error", message: "The clip must be 4–30 s" } } } : { body: { data: { url: STORED, durationSec: 8 } } }
    download.mockResolvedValue({ status: "completed", videoUrl: DOWNLOADED })
    renderEditor()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/a link to a YouTube, TikTok/), "https://www.tiktok.com/@a/video/123{Enter}")
    const step = await screen.findByRole("group", { name: "New source clip" })
    loadVideo({ sec: 20 })
    await user.click(within(step).getByRole("button", { name: "Move the range" }))
    await user.click(within(step).getByRole("button", { name: "Cut and use this clip" }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toHaveLength(1))
    await waitFor(() => expect(within(step).getByRole("button", { name: "Cut and use this clip" })).toBeEnabled())
    expect(sentTo("POST /v1/media/discard")).toEqual([])

    refuse = false
    await user.click(within(step).getByRole("button", { name: "Cut and use this clip" }))
    await waitFor(() => expect(sentTo("POST /v1/media/discard")).toHaveLength(2))
    expect(sentTo("POST /v1/media/process")).toHaveLength(1)
    expect(sentTo(`POST ${BASE}/media`)).toEqual([
      { url: CUT, kind: "source" },
      { url: CUT, kind: "source" },
    ])
  })
})
