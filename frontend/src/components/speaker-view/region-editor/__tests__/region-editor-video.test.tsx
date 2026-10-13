/**
 * The region editor on a video fed in place of an edit (no Edit Plan), with
 * Speaker Frames' face tracks wired and its matcher abstained — the
 * "Which face is …?" guide of tap-first face-to-speaker (decided 2026-10-13).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode is open only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))

import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react"
import { SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE } from "@nodaro/render-rules"
import { RegionEditorDialog } from "../region-editor-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { translate } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

const CLIP = "https://cdn/uploads/videos/clip.mp4"
const JOB = "11111111-2222-4333-8444-555555555555"

/** A 14 s two-host wide: the man talks first, the woman from 12 s. */
const TRANSCRIPT = {
  version: 1,
  words: [
    { text: "So", startMs: 200, endMs: 600, speaker: "speaker_0" },
    { text: "anyway", startMs: 3000, endMs: 3600, speaker: "speaker_0" },
    { text: "Right", startMs: 12_000, endMs: 12_800, speaker: "speaker_1" },
  ],
}

const box = (ms: number, x: number) => ({ ms, x, y: 0.2, w: 0.1, h: 0.2 })
/** Matcher abstained on every track; the woman was lost at 6 s and picked up again as t3. */
const BODY = {
  version: 1, sampleFps: 2, detector: { id: "yunet" },
  sources: [{ sourceId: "video", clock: "source", frame: { w: 640, h: 360 }, sampledSpans: [{ startMs: 0, endMs: 14_000 }], tracks: [
    { id: "video/t1", boxes: [box(0, 0.2), box(500, 0.2), box(12_000, 0.2)] },
    { id: "video/t2", boxes: [box(0, 0.7), box(5500, 0.7)] },
    { id: "video/t3", boxes: [box(9000, 0.7), box(12_000, 0.7)] },
  ] }],
}

async function seed(opts: { url?: string; tracks?: boolean; transcript?: boolean } = {}) {
  const { createHash } = await import("node:crypto")
  const bytes = new TextEncoder().encode(JSON.stringify(BODY))
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const descriptor = {
    version: 1, sampleFps: 2, detector: { id: "yunet" }, url: `https://cdn/speaker-tracks/${JOB}.json`, sha256, bytes: bytes.length,
    sources: [{ ...BODY.sources[0]!, tracks: BODY.sources[0]!.tracks.map(({ boxes, ...h }) => ({ ...h, boxCount: boxes.length })) }],
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } })))
  const withTracks = opts.tracks !== false
  const withTranscript = opts.transcript !== false
  const nodes = [
    { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Clip", url: opts.url ?? CLIP, metadata: { width: 640, height: 360 } } },
    ...(withTranscript ? [{ id: "tx", type: "transcribe", position: { x: 0, y: 0 }, data: { label: "Transcribe", generatedResults: [{ url: "", transcript: TRANSCRIPT }], activeResultIndex: 0 } }] : []),
    ...(withTracks ? [{ id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames", fieldMappings: {}, generatedJson: descriptor } }] : []),
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, targetAspect: "9:16" } },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: "e1", source: "up", target: "sv", targetHandle: "video" },
    ...(withTranscript ? [{ id: "e2", source: "tx", target: "sv", targetHandle: "transcript" }] : []),
    ...(withTracks ? [{ id: "e3", source: "sf", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" }, { id: "e4", source: "up", target: "sf", targetHandle: "video" }] : []),
  ] as unknown as WorkflowEdge[]
  useWorkflowStore.setState({ nodes, edges, isReadOnly: false } as never)
}

const open = () => render(<RegionEditorDialog nodeId="sv" label="Speaker View" onClose={() => {}} />)
const sfData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "sf")!.data as Record<string, unknown>

function loadVideo() {
  const video = document.querySelector("video")!
  Object.defineProperty(video, "videoWidth", { value: 640, configurable: true })
  Object.defineProperty(video, "videoHeight", { value: 360, configurable: true })
  Object.defineProperty(video, "duration", { value: 14, configurable: true })
  act(() => { fireEvent.loadedMetadata(video) })
  return video
}

const chip = (trackId: string) => screen.getByTestId(`region-face-${trackId}`).querySelector("button")!

beforeEach(() => {
  flag.priced = true
  flag.frames = true
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("RegionEditorDialog — a video in place of an edit", () => {
  it("lists every speaker of the clip, including one who first talks at 12 s", async () => {
    await seed({ tracks: false })
    open()
    const list = screen.getByTestId("region-list")
    expect(within(list).getByRole("button", { name: /speaker_0/ })).toBeTruthy()
    expect(within(list).getByRole("button", { name: /speaker_1/ })).toBeTruthy()
  })

  it("says what to run first when the video has no address yet — never Edit Plan", async () => {
    await seed({ url: "" })
    open()
    expect(screen.getByTestId("region-editor-empty").textContent).toBe(t("speakerView.framing.noVideo"))
  })

  it("R15: while video mode is not live, the empty editor reads as before and no guide is shown", async () => {
    flag.frames = false
    await seed({ url: "" })
    open()
    expect(screen.getByTestId("region-editor-empty").textContent).toBe(t("speakerView.framing.noEdit"))
    cleanup()
    await seed()
    open()
    loadVideo()
    await screen.findByTestId("region-face-video/t1")
    expect(screen.queryByTestId("region-face-guide")).toBeNull()
  })
})

describe("RegionEditorDialog — a camera with no speaker to frame (hide + explain, decided 2026-10-13)", () => {
  const footerButton = (key: "speakerView.framing.reset" | "speakerView.framing.save") => screen.getByRole("button", { name: t(key) }) as HTMLButtonElement

  it("while video mode is not live, says only that it is not available yet, never a blank frame; Reset and Save are off", async () => {
    flag.frames = false
    await seed({ tracks: false, transcript: false })
    open()
    expect(screen.getByTestId("region-editor-no-speakers").textContent).toBe(t("speakerView.videoModeNotLive"))
    expect(screen.queryByTestId("region-frame")).toBeNull()
    expect(document.querySelector("video")).toBeNull()
    expect(footerButton("speakerView.framing.reset").disabled).toBe(true)
    expect(footerButton("speakerView.framing.save").disabled).toBe(true)
  })

  it("once video mode is live, says what to connect so Speaker View knows who is talking; Reset and Save are off", async () => {
    await seed({ tracks: false, transcript: false })
    open()
    expect(screen.getByTestId("region-editor-no-speakers").textContent).toBe(t("speakerView.framing.noSpeakers"))
    expect(document.querySelector("video")).toBeNull()
    expect(footerButton("speakerView.framing.reset").disabled).toBe(true)
    expect(footerButton("speakerView.framing.save").disabled).toBe(true)
  })

  it("the sentence the editor shows while video mode is not live is the rule's own refusal", () => {
    expect(t("speakerView.videoModeNotLive")).toBe(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
  })

  it("never hides the face guide: with video mode live and face tracks wired, the editor opens on the frame and its tracked faces", async () => {
    await seed({ transcript: false })
    open()
    expect(screen.queryByTestId("region-editor-no-speakers")).toBeNull()
    loadVideo()
    expect(await screen.findByTestId("region-face-video/t1")).toBeTruthy()
  })

  it("with speakers to frame, the editor opens as before", async () => {
    flag.frames = false
    await seed({ tracks: false })
    open()
    expect(screen.queryByTestId("region-editor-no-speakers")).toBeNull()
    expect(screen.getByTestId("region-list")).toBeTruthy()
  })
})

describe("RegionEditorDialog — Which face is …? (tap-first)", () => {
  it("asks for each speaker at a moment they talk, a click on a face names it, then each loose fragment; Save writes the corrections on Speaker Frames", async () => {
    await seed()
    open()
    const video = loadVideo()
    await screen.findByTestId("region-face-video/t1")
    const guide = () => screen.getByTestId("region-face-guide")

    // 1. The man: the frame is at 0.5 s, where he talks and his face is on screen.
    expect(guide().textContent).toContain(t("speakerView.framing.whichFace", { speaker: "speaker_0" }))
    expect(video.currentTime).toBe(0.5)
    fireEvent.click(chip("video/t1"))

    // 2. The woman: the frame jumps to 12 s.
    expect(guide().textContent).toContain(t("speakerView.framing.whichFace", { speaker: "speaker_1" }))
    expect(video.currentTime).toBe(12)
    fireEvent.click(await screen.findByTestId("region-face-video/t3").then((el) => el.querySelector("button")!))

    // 3. Her earlier fragment, tied to no one: one more tap.
    expect(guide().textContent).toContain(t("speakerView.framing.whoIsThis"))
    expect(guide().textContent).toContain("video/t2")
    expect(video.currentTime).toBe(0)
    fireEvent.click(within(guide()).getByRole("button", { name: "speaker_1" }))

    expect(screen.getByTestId("region-face-guide-done").textContent).toBe(t("speakerView.framing.guideDone"))
    expect(sfData().trackAssignments).toBeUndefined()
    fireEvent.click(screen.getByRole("button", { name: t("speakerView.framing.save") }))
    expect(sfData().trackAssignments).toEqual([
      { trackId: "video/t1", speaker: "speaker_0", rawSpeaker: "speaker_0" },
      { trackId: "video/t3", speaker: "speaker_1", rawSpeaker: "speaker_1" },
      { trackId: "video/t2", speaker: "speaker_1", rawSpeaker: "speaker_1" },
    ])
  })

  it("Skip moves on; Nobody ties a fragment to no one", async () => {
    await seed()
    open()
    loadVideo()
    await screen.findByTestId("region-face-video/t1")
    const guide = () => screen.getByTestId("region-face-guide")
    fireEvent.click(within(guide()).getByRole("button", { name: t("speakerView.framing.guideSkip") }))
    expect(guide().textContent).toContain(t("speakerView.framing.whichFace", { speaker: "speaker_1" }))
    fireEvent.click(within(guide()).getByRole("button", { name: t("speakerView.framing.guideSkip") }))
    // The fragments, in time order.
    expect(guide().textContent).toContain("video/t1")
    fireEvent.click(within(guide()).getByRole("button", { name: t("speakerView.framing.assignNobody") }))
    expect(guide().textContent).toContain("video/t2")
  })

  it("a speaker with a box drawn and saved is framed by it, so the guide does not ask about them — as the badge", async () => {
    await seed()
    const region = { x: 0.05, y: 0, w: 0.3, h: 1 }
    const nodes = useWorkflowStore.getState().nodes.map((n) =>
      n.id === "sv" ? { ...n, data: { ...n.data, speakerRegions: [{ source: "video", speaker: "speaker_0", region }], defaultRegionKeys: [] } } : n,
    )
    useWorkflowStore.setState({ nodes } as never)
    open()
    loadVideo()
    await screen.findByTestId("region-face-video/t1")
    expect(screen.getByTestId("region-face-guide").textContent).toContain(t("speakerView.framing.whichFace", { speaker: "speaker_1" }))
  })

  it("in a Which face step, a click on a face already named for someone else does not take it over", async () => {
    await seed()
    const nodes = useWorkflowStore.getState().nodes.map((n) =>
      n.id === "sf" ? { ...n, data: { ...n.data, trackAssignments: [{ trackId: "video/t1", speaker: "speaker_1", rawSpeaker: "speaker_1" }] } } : n,
    )
    useWorkflowStore.setState({ nodes } as never)
    open()
    loadVideo()
    await screen.findByTestId("region-face-video/t1")
    expect(screen.getByTestId("region-face-guide").textContent).toContain(t("speakerView.framing.whichFace", { speaker: "speaker_0" }))
    fireEvent.click(chip("video/t1"))
    expect(screen.getByTestId("region-face-guide").textContent).toContain(t("speakerView.framing.whichFace", { speaker: "speaker_0" }))
    expect(document.activeElement).toBe(screen.getByTestId("region-face-assign-video/t1"))
  })

  it("a speaker the matcher already named is not asked about", async () => {
    await seed()
    const nodes = useWorkflowStore.getState().nodes.map((n) =>
      n.id === "sf" ? { ...n, data: { ...n.data, trackAssignments: [{ trackId: "video/t1", speaker: "speaker_0", rawSpeaker: "speaker_0" }] } } : n,
    )
    useWorkflowStore.setState({ nodes } as never)
    open()
    loadVideo()
    await screen.findByTestId("region-face-video/t1")
    expect(screen.getByTestId("region-face-guide").textContent).toContain(t("speakerView.framing.whichFace", { speaker: "speaker_1" }))
  })
})
