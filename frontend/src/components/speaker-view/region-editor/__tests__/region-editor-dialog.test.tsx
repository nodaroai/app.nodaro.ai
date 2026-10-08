/**
 * The region editor (U4, U4b) on a real canvas store: a Camera Switch edit of
 * a two-speaker wide shot plus a close-up, opened from a Speaker View node.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react"
import { RegionEditorDialog } from "../region-editor-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

const EDL = {
  version: 1,
  clock: "master",
  sources: [
    { id: "wide", url: "https://cdn/wide.mp4", kind: "video", role: "wide" },
    { id: "camA", url: "https://cdn/a.mov", kind: "video", offsetMs: 4000 },
    { id: "mic", url: "https://cdn/mic.wav", kind: "audio", role: "master-audio" },
  ],
  segments: [
    { id: "s1", inMs: 0, outMs: 5000, video: "wide", speaker: "Host" },
    { id: "s2", inMs: 5000, outMs: 12_000, video: "wide", speaker: "Guest" },
    { id: "s3", inMs: 12_000, outMs: 20_000, video: "camA", speaker: "Host" },
  ],
}

const TRANSCRIPT = {
  version: 1,
  words: [
    { text: "So", startMs: 0, endMs: 300, speaker: "speaker_0" },
    { text: "the", startMs: 300, endMs: 600, speaker: "speaker_0" },
    { text: "thing", startMs: 600, endMs: 900, speaker: "speaker_0" },
    { text: "Right", startMs: 5000, endMs: 5400, speaker: "speaker_1" },
  ],
}

function seed(svData: Record<string, unknown> = {}, opts: { edl?: unknown } = {}) {
  const nodes = [
    { id: "upW", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Wide", url: "https://cdn/wide.mp4", thumbnailUrl: "https://cdn/wide.jpg", metadata: { width: 1920, height: 1080 } } },
    { id: "upA", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Cam A", url: "https://cdn/a.mov", thumbnailUrl: "https://cdn/a.jpg", metadata: { width: 1920, height: 1080 } } },
    {
      id: "cs", type: "camera-switch", position: { x: 0, y: 0 },
      data: { label: "Camera Switch", speakerNames: { speaker_0: "Host", speaker_1: "Guest" }, generatedJson: { edl: opts.edl === undefined ? EDL : opts.edl, transcript: TRANSCRIPT } },
    },
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, targetAspect: "9:16", ...svData } },
  ] as unknown as WorkflowNode[]
  const edges = [
    ...(opts.edl === null ? [] : [{ id: "e1", source: "cs", target: "sv", targetHandle: "edl" }]),
    { id: "e2", source: "cs", target: "sv", targetHandle: "transcript" },
  ] as unknown as WorkflowEdge[]
  useWorkflowStore.setState({ nodes, edges, isReadOnly: false } as never)
}

/** What Save writes for the never-saved fixture: the thirds of the shared wide shot. */
const SAVED_THIRDS = [
  { source: "wide", speaker: "Host", region: { x: 0.0918, y: 0, w: 0.3164, h: 1 } },
  { source: "wide", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } },
]

const svData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "sv")!.data as Record<string, unknown>

function open(onClose = () => {}) {
  return render(<RegionEditorDialog nodeId="sv" label="Speaker View" onClose={onClose} />)
}

/** jsdom has no media pipeline: stand in for the camera's metadata arriving. */
function loadVideo(width = 1920, height = 1080, durationSec = 60) {
  const video = document.querySelector("video")!
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true })
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true })
  Object.defineProperty(video, "duration", { value: durationSec, configurable: true })
  act(() => { fireEvent.loadedMetadata(video) })
  return video
}

const dialog = () => screen.getByRole("dialog")
const press = (key: string, init: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(dialog(), { key, ...init }) })

beforeEach(() => seed())
afterEach(() => cleanup())

describe("RegionEditorDialog — what it lists and draws", () => {
  it("lists each camera and its speakers, the shared wide shot first", () => {
    open()
    const list = screen.getByTestId("region-list")
    expect(within(list).getByRole("button", { name: /wide/ })).toBeTruthy()
    expect(within(list).getByRole("button", { name: /Host/ })).toBeTruthy()
    expect(within(list).getByRole("button", { name: /Guest/ })).toBeTruthy()
    expect(within(list).getByRole("button", { name: /camA/ }).textContent).toContain(t("speakerView.framing.fullFrame"))
  })

  it("draws the default thirds on the shared camera, the selected box with handles", () => {
    open()
    expect(screen.getByTestId("region-box-Host").querySelectorAll("[data-handle]")).toHaveLength(8)
    expect(screen.getByTestId("region-box-Guest").querySelectorAll("[data-handle]")).toHaveLength(0)
    expect(screen.getByTestId("region-cover-crop")).toBeTruthy()
  })

  it("states the cover crop's resolution, amber above 1.5× (SV8 a)", () => {
    open()
    expect(screen.getByTestId("region-chip").textContent).toBe(t("speakerView.framing.chip", { from: "607 × 1080", to: "1080 × 1920", factor: "1.8" }))
    expect(screen.getByTestId("region-chip").className).toContain("amber")
  })

  it("quotes the speaker under their raw label and display name (SV15)", () => {
    open()
    expect(screen.getByTestId("region-quote").textContent).toContain("So the thing")
    expect(screen.getByTestId("region-quote").textContent).toContain("speaker_0 (Host)")
  })

  it("offers each slot shape the speaker is drawn in", () => {
    seed({ targetAspect: "9:16", layout: "stacked" })
    open()
    expect(screen.getByRole("radiogroup", { name: t("speakerView.framing.showAs") }).textContent).toContain(t("speakerView.layout.stacked"))
  })

  it("says what to run first when no edit is known (U4b)", () => {
    seed({}, { edl: null })
    open()
    expect(screen.getByTestId("region-editor-empty").textContent).toBe(t("speakerView.framing.noEdit"))
  })
})

describe("RegionEditorDialog — editing and saving", () => {
  it("saves every box shown, as tidy fractions; a close-up stays full frame", () => {
    let closed = false
    open(() => { closed = true })
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.save") }))
    expect(closed).toBe(true)
    expect(svData().speakerRegions).toEqual([
      { source: "wide", speaker: "Host", region: { x: 0.0918, y: 0, w: 0.3164, h: 1 } },
      { source: "wide", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } },
    ])
  })

  it("F frames the selected speaker full; ⌘Z undoes it, ⇧⌘Z redoes it", () => {
    open()
    press("f")
    expect(screen.getByTestId("region-box-Host").style.width).toBe("100%")
    press("z", { metaKey: true })
    expect(screen.getByTestId("region-box-Host").style.width).not.toBe("100%")
    press("z", { metaKey: true, shiftKey: true })
    expect(screen.getByTestId("region-box-Host").style.width).toBe("100%")
  })

  it("arrows nudge the box by one source pixel (⇧ ten)", () => {
    open()
    const before = parseFloat(screen.getByTestId("region-box-Host").style.left)
    press("ArrowRight")
    expect(parseFloat(screen.getByTestId("region-box-Host").style.left)).toBeCloseTo(before + 100 / 1920, 6)
    press("ArrowRight", { shiftKey: true })
    expect(parseFloat(screen.getByTestId("region-box-Host").style.left)).toBeCloseTo(before + 1100 / 1920, 6)
  })

  it("a corner drag keeps the box's shape and is one undo step; an edge drag frees it", () => {
    open()
    const frame = screen.getByTestId("region-frame")
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} }) as DOMRect
    const box = () => screen.getByTestId("region-box-Host")
    const size = () => [parseFloat(box().style.width), parseFloat(box().style.height)]
    const handle = (h: string) => box().querySelector(`[data-handle="${h}"]`) as HTMLElement
    const [w0, h0] = size()
    fireEvent.pointerDown(handle("sw"), { clientX: 100, clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle("sw"), { clientX: 120, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(handle("sw"), { clientX: 130, clientY: 250, pointerId: 1 })
    fireEvent.pointerUp(handle("sw"), { clientX: 130, clientY: 250, pointerId: 1 })
    const [w1, h1] = size()
    expect(w1).toBeLessThan(w0)
    expect(w1 / h1).toBeCloseTo(w0 / h0, 6)
    press("z", { metaKey: true })
    expect(size()).toEqual([w0, h0])
    fireEvent.pointerDown(handle("e"), { clientX: 400, clientY: 250, pointerId: 2 })
    fireEvent.pointerMove(handle("e"), { clientX: 450, clientY: 250, pointerId: 2 })
    fireEvent.pointerUp(handle("e"), { pointerId: 2 })
    expect(size()[0]).toBeCloseTo(w0 + 5, 6)
    expect(size()[1]).toBe(h0)
  })

  it("Tab cycles boxes by moving through them: each box is a tab stop, and focusing one selects it", () => {
    open()
    const guest = screen.getByTestId("region-box-Guest")
    expect(screen.getByTestId("region-box-Host").tabIndex).toBe(0)
    expect(guest.tabIndex).toBe(0)
    act(() => { guest.focus() })
    expect(guest.querySelectorAll("[data-handle]")).toHaveLength(8)
    // Arrows nudge the box that has focus.
    const before = parseFloat(guest.style.left)
    act(() => { fireEvent.keyDown(guest, { key: "ArrowRight" }) })
    expect(parseFloat(screen.getByTestId("region-box-Guest").style.left)).toBeCloseTo(before + 100 / 1920, 6)
  })

  it("Tab is never taken over, so focus can always leave the frame for Save, Cancel and the rest", () => {
    open()
    // Where focus lands when the dialog opens, and on a box: the browser moves it.
    const fromDialog = fireEvent.keyDown(dialog(), { key: "Tab" })
    const fromBox = fireEvent.keyDown(screen.getByTestId("region-box-Guest"), { key: "Tab", shiftKey: true })
    expect(fromDialog).toBe(true)
    expect(fromBox).toBe(true)
    expect(screen.getByTestId("region-box-Host").querySelectorAll("[data-handle]")).toHaveLength(8)
  })

  it("with focus on a button, arrows still nudge", () => {
    open()
    const swap = screen.getByRole("button", { name: t("speakerView.framing.swap") })
    const before = parseFloat(screen.getByTestId("region-box-Host").style.left)
    act(() => { fireEvent.keyDown(swap, { key: "ArrowRight" }) })
    expect(parseFloat(screen.getByTestId("region-box-Host").style.left)).toBeCloseTo(before + 100 / 1920, 6)
  })

  it("a click on a box that moves nothing is no undo step: ⌘Z still undoes the last edit", () => {
    open()
    press("f")
    expect(screen.getByTestId("region-box-Host").style.width).toBe("100%")
    const frame = screen.getByTestId("region-frame")
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} }) as DOMRect
    const guest = screen.getByTestId("region-box-Guest")
    fireEvent.pointerDown(guest, { clientX: 700, clientY: 250, pointerId: 3 })
    fireEvent.pointerMove(guest, { clientX: 700, clientY: 250, pointerId: 3 })
    fireEvent.pointerUp(guest, { clientX: 700, clientY: 250, pointerId: 3 })
    press("z", { metaKey: true })
    expect(screen.getByTestId("region-box-Host").style.width).not.toBe("100%")
  })

  it("the header copies the framing Save would write, as JSON (U4 ⧉)", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    open()
    fireEvent.click(screen.getByRole("button", { name: t("cfgext.scrapeCopyJson") }))
    expect(JSON.parse((writeText.mock.calls[0] as unknown as [string])[0])).toEqual([
      { source: "wide", speaker: "Host", region: { x: 0.0918, y: 0, w: 0.3164, h: 1 } },
      { source: "wide", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } },
    ])
  })

  it("on a read-only workflow nothing can be saved", () => {
    useWorkflowStore.setState({ isReadOnly: true } as never)
    open()
    expect((screen.getByRole("button", { name: t("speakerView.framing.save") }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("Swap trades the two speakers' boxes", () => {
    open()
    const host = screen.getByTestId("region-box-Host").style.left
    const guest = screen.getByTestId("region-box-Guest").style.left
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.swap") }))
    expect(screen.getByTestId("region-box-Host").style.left).toBe(guest)
    expect(screen.getByTestId("region-box-Guest").style.left).toBe(host)
  })

  it("Reset to thirds brings the defaults back", () => {
    seed({ speakerRegions: [{ source: "wide", speaker: "Host", region: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }] })
    open()
    expect(screen.getByTestId("region-box-Host").style.left).toBe("50%")
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.reset") }))
    expect(parseFloat(screen.getByTestId("region-box-Host").style.left)).toBeCloseTo(9.18, 1)
  })

  it("closing with unsaved changes asks first; Keep editing stays, Discard leaves without saving", () => {
    let closed = false
    open(() => { closed = true })
    press("f")
    press("Escape")
    expect(screen.getByText(t("speakerView.framing.discardTitle"))).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.keepEditing") }))
    expect(closed).toBe(false)
    press("Escape")
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.discard") }))
    expect(closed).toBe(true)
    expect(svData().speakerRegions).toBeUndefined()
  })

  it("closing untouched saved framing does not ask", () => {
    seed({ speakerRegions: SAVED_THIRDS })
    let closed = false
    open(() => { closed = true })
    press("Escape")
    expect(closed).toBe(true)
  })

  // Decided 2026-10-08 (review of #2018): a never-saved node still renders full
  // frame, so the thirds the editor draws for it are a change Save would make.
  it("never-saved framing opens with its drawn thirds unsaved: Escape asks, Discard writes nothing", () => {
    let closed = false
    open(() => { closed = true })
    press("Escape")
    expect(screen.getByText(t("speakerView.framing.discardTitle"))).toBeTruthy()
    expect(closed).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.discard") }))
    expect(closed).toBe(true)
    expect(svData().speakerRegions).toBeUndefined()
  })

  it("never-saved framing: Cancel asks too, and Keep editing stays without writing", () => {
    let closed = false
    open(() => { closed = true })
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }))
    expect(screen.getByText(t("speakerView.framing.discardTitle"))).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.keepEditing") }))
    expect(closed).toBe(false)
    expect(svData().speakerRegions).toBeUndefined()
  })

  it("Reset to thirds on never-saved framing is still unsaved", () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.reset") }))
    press("Escape")
    expect(screen.getByText(t("speakerView.framing.discardTitle"))).toBeTruthy()
    expect(svData().speakerRegions).toBeUndefined()
  })

  it("Reset to thirds on saved framing that differs is unsaved too", () => {
    seed({ speakerRegions: [{ source: "wide", speaker: "Host", region: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }, SAVED_THIRDS[1]!] })
    open()
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.reset") }))
    press("Escape")
    expect(screen.getByText(t("speakerView.framing.discardTitle"))).toBeTruthy()
  })

  it("saving the drawn thirds, then reopening, is untouched", () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.save") }))
    cleanup()
    let closed = false
    open(() => { closed = true })
    press("Escape")
    expect(closed).toBe(true)
  })

  it("a saved speaker beside a never-saved one on a shared camera: the drawn default is unsaved", () => {
    seed({ speakerRegions: [SAVED_THIRDS[0]!] })
    open()
    press("Escape")
    expect(screen.getByText(t("speakerView.framing.discardTitle"))).toBeTruthy()
  })

  it("an edit with only close-ups draws no default, so closing it untouched does not ask", () => {
    seed({}, { edl: { ...EDL, segments: [{ id: "s1", inMs: 0, outMs: 5000, video: "wide", speaker: "Host" }, { id: "s3", inMs: 5000, outMs: 9000, video: "camA", speaker: "Guest" }] } })
    let closed = false
    open(() => { closed = true })
    press("Escape")
    expect(closed).toBe(true)
  })
})

describe("RegionEditorDialog — the frame (SV9 a + d)", () => {
  it("plays the original; Jump to seeks the camera at master − offsetMs, enabled once its length is known", () => {
    open()
    fireEvent.click(within(screen.getByTestId("region-list")).getByRole("button", { name: /camA/ }))
    const jump = screen.getByRole("button", { name: t("speakerView.framing.jump", { speaker: "Host" }) })
    expect((jump as HTMLButtonElement).disabled).toBe(true)
    const video = loadVideo(1920, 1080, 60)
    expect((jump as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(jump)
    // Host's turn starts at master 12 s; Cam A started 4 s late: its own 8 s.
    expect(video.currentTime).toBe(8)
  })

  it("a camera the browser cannot play falls back to its upload's thumbnail", () => {
    open()
    act(() => { fireEvent.error(document.querySelector("video")!) })
    expect(screen.getByTestId("region-no-frame").textContent).toBe(t("speakerView.framing.thumbnailFallbackExt", { ext: ".mp4" }))
    expect(screen.getByTestId("region-frame").querySelector("img")?.getAttribute("src")).toBe("https://cdn/wide.jpg")
  })

  it("names no container when the camera's URL has no extension", () => {
    seed({}, { edl: { ...EDL, sources: EDL.sources.map((x) => (x.id === "wide" ? { ...x, url: "https://cdn/wide?sig=a.b" } : x)) } })
    useWorkflowStore.setState({
      nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === "upW" ? { ...n, data: { ...n.data, url: "https://cdn/wide?sig=a.b" } } : n)),
    } as never)
    open()
    act(() => { fireEvent.error(document.querySelector("video")!) })
    expect(screen.getByTestId("region-no-frame").textContent).toBe(t("speakerView.framing.thumbnailFallback"))
  })

  describe("OUTPUT draws the frame as soon as it can be drawn", () => {
    const drawImage = vi.fn()
    const real = HTMLCanvasElement.prototype.getContext
    beforeEach(() => {
      drawImage.mockClear()
      HTMLCanvasElement.prototype.getContext = (() => ({ fillStyle: "", fillRect() {}, drawImage })) as unknown as typeof real
    })
    afterEach(() => { HTMLCanvasElement.prototype.getContext = real })

    it("when the camera's first frame decodes (no seek, no play)", () => {
      open()
      const video = loadVideo()
      drawImage.mockClear()
      act(() => { fireEvent.loadedData(video) })
      expect(drawImage).toHaveBeenCalled()
    })

    it("when the thumbnail loads, even with its size already known from the upload", () => {
      open()
      act(() => { fireEvent.error(document.querySelector("video")!) })
      const img = screen.getByTestId("region-frame").querySelector("img")!
      Object.defineProperty(img, "naturalWidth", { value: 1920, configurable: true })
      Object.defineProperty(img, "naturalHeight", { value: 1080, configurable: true })
      drawImage.mockClear()
      act(() => { fireEvent.load(img) })
      expect(drawImage).toHaveBeenCalled()
    })
  })

  it("on a phone: a camera menu and one box at a time", () => {
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      open()
      expect(screen.getByRole("combobox", { name: t("speakerView.framing.cameras") })).toBeTruthy()
      expect(screen.queryByTestId("region-list")).toBeNull()
      expect(screen.getByTestId("region-box-Host")).toBeTruthy()
      expect(screen.queryByTestId("region-box-Guest")).toBeNull()
      fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.nextBox") }))
      expect(screen.getByTestId("region-box-Guest")).toBeTruthy()
      expect(screen.queryByTestId("region-box-Host")).toBeNull()
    } finally {
      window.matchMedia = real
    }
  })
})
