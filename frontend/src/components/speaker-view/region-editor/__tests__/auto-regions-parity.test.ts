/**
 * "Split the camera by speaker" (`autoRegions`, decided 2026-10-13) renders the
 * very boxes the region editor starts from: the run's `speakerViewAutoRegions`
 * equals what the editor shows (and Save would write) for a never-framed node,
 * on edits where the edit's own speaker list and who is on screen differ. A
 * clip pack (decided 2026-10-14): every row the run sends, the panel's view of
 * the batch and the editor deal the same boxes over the episode's speakers.
 */
import { afterEach, describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { speakerViewAutoRegions, speakerViewContext, speakerViewVideoEdit, speakerViewWireSettings } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { speakerViewContextOf } from "@/lib/speaker-view-context"
import type { WorkflowNode } from "@/types/nodes"
import { useRegionEditor } from "../use-region-editor"

const CAM = { id: "cam", url: "https://cdn/cam.mp4", kind: "video" }

function seed(sv: Record<string, unknown>) {
  const nodes = [
    // The camera's upload: the editor learns its 16:9 frame from it.
    { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Cam", url: CAM.url, metadata: { width: 1920, height: 1080 } } },
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, targetAspect: "9:16", layout: "single", ...sv } },
  ] as unknown as WorkflowNode[]
  useWorkflowStore.setState({ nodes, edges: [], isReadOnly: false } as never)
}

/** What the editor shows for a never-framed node, and what the run sends with the flag on. */
function both(sv: Record<string, unknown>) {
  seed({ ...sv, autoRegions: true })
  const { result } = renderHook(() => useRegionEditor("sv"))
  const { nodes, edges } = useWorkflowStore.getState()
  const data = nodes.find((n) => n.id === "sv")!.data as Record<string, unknown>
  const ctx = speakerViewContextOf("sv", nodes, edges)
  return { editor: result.current.rows, auto: speakerViewAutoRegions(data, ctx), wire: speakerViewWireSettings(data, ctx).speakerRegions, dirty: result.current.dirty }
}

afterEach(() => useWorkflowStore.setState({ nodes: [], edges: [] } as never))

describe("autoRegions deals the editor's default boxes over who is on screen", () => {
  it("a named edit whose segments are not in clock order (the hook moved first): dealt by first appearance on the master clock", () => {
    const edl = {
      version: 1, clock: "master", sources: [CAM],
      segments: [
        { id: "hook", inMs: 30_000, outMs: 34_000, video: "cam", speaker: "Guest" },
        { id: "s0", inMs: 0, outMs: 5_000, video: "cam", speaker: "Host" },
        { id: "s1", inMs: 5_000, outMs: 9_000, video: "cam", speaker: "Guest" },
      ],
    }
    const { editor, auto, wire } = both({ edl })
    expect(editor).toHaveLength(2)
    expect(auto).toEqual(editor)
    expect(wire).toEqual(editor)
    // Host speaks first on the clock: the left box, though the edit lists Guest first.
    expect(auto[0]).toMatchObject({ speaker: "Host", region: { x: 0.0918 } })
  })

  it("a transcript-only edit that cuts material: a speaker heard only in the cut gets no share", () => {
    const edl = {
      version: 1, clock: "master", sources: [CAM],
      segments: [
        { id: "s0", inMs: 0, outMs: 5_000, video: "cam" },
        { id: "s1", inMs: 20_000, outMs: 25_000, video: "cam" },
      ],
    }
    const transcript = {
      version: 1,
      words: [
        { text: "hi", startMs: 0, endMs: 1_000, speaker: "A" },
        { text: "cut", startMs: 10_000, endMs: 11_000, speaker: "B" },
        { text: "yo", startMs: 20_000, endMs: 21_000, speaker: "C" },
      ],
    }
    const { editor, auto, wire } = both({ edl, transcript })
    expect(editor.map((r) => r.speaker)).toEqual(["A", "C"])
    expect(auto).toEqual(editor)
    expect(wire).toEqual(editor)
  })

  it("a speaker named only in a layout hint, under a layout that drops hints: not on screen, not dealt", () => {
    const edl = {
      version: 1, clock: "master", sources: [CAM],
      segments: [
        { id: "s0", inMs: 0, outMs: 5_000, video: "cam", speaker: "Host" },
        { id: "s1", inMs: 5_000, outMs: 9_000, video: "cam", speaker: "Guest" },
        { id: "s2", inMs: 9_000, outMs: 12_000, video: "cam", speaker: "Host", layout: { mode: "side-by-side", slots: [{ source: "cam", speaker: "Host" }, { source: "cam", speaker: "Third" }] } },
      ],
    }
    const { editor, auto, wire } = both({ edl })
    expect(editor.map((r) => r.speaker)).toEqual(["Host", "Guest"])
    expect(auto).toEqual(editor)
    expect(wire).toEqual(editor)
  })
})

describe("the editor's unsaved-defaults prompt knows the flag", () => {
  const edl = {
    version: 1, clock: "master", sources: [CAM],
    segments: [
      { id: "s0", inMs: 0, outMs: 5_000, video: "cam", speaker: "Host" },
      { id: "s1", inMs: 5_000, outMs: 9_000, video: "cam", speaker: "Guest" },
    ],
  }

  it("with the flag on, the defaults on screen are what the run draws: closing loses nothing", () => {
    expect(both({ edl }).dirty).toBe(false)
  })

  it("with it off, never-saved defaults are still an unsaved change", () => {
    seed({ edl })
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.dirty).toBe(true)
  })
})

describe("a bare video (decided 2026-10-13): the editor lists every transcript speaker, not only the idle edit's first second", () => {
  const URL = "https://cdn/rec.mp4"
  const transcript = {
    version: 1,
    words: [
      { text: "hi", startMs: 0, endMs: 400, speaker: "A" },
      { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "B" },
      { text: "so", startMs: 9_000, endMs: 9_400, speaker: "A" },
    ],
  }

  it("lists both speakers, and its defaults are the rows the measured run sends", () => {
    const nodes = [
      { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Rec", url: URL, metadata: { width: 1920, height: 1080 } } },
      { id: "tx", type: "transcribe", position: { x: 0, y: 0 }, data: { label: "Transcribe", generatedResults: [{ url: "", transcript }], activeResultIndex: 0 } },
      { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, targetAspect: "9:16", layout: "single", autoRegions: true } },
    ] as unknown as WorkflowNode[]
    const edges = [
      { id: "e1", source: "up", target: "sv", targetHandle: "video" },
      { id: "e2", source: "tx", target: "sv", targetHandle: "transcript" },
    ]
    useWorkflowStore.setState({ nodes, edges, isReadOnly: false } as never)
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.model.cameras[0]!.pairs.map((p) => p.speaker)).toEqual(["A", "B"])

    const measured = speakerViewVideoEdit({ url: URL, clip: { durationMs: 14_600, width: 1920, height: 1080 }, transcript, targetAspect: "9:16" })
    if (!measured.ok) throw new Error(measured.message)
    const data = nodes.find((n) => n.id === "sv")!.data as Record<string, unknown>
    const run = speakerViewAutoRegions(data, speakerViewContext(measured.edl, transcript))
    expect(run).toHaveLength(2)
    expect(result.current.rows).toEqual(run)
    // The idle readers (panel, badge, review) read the same rows off the canvas.
    expect(speakerViewAutoRegions(data, speakerViewContextOf("sv", nodes, edges as never))).toEqual(run)
    expect(result.current.dirty).toBe(false)
  })
})

describe("a clip pack (decided 2026-10-14): every clip is boxed alike, over the episode's speakers", () => {
  const seg = (id: string, inMs: number, speaker: string) => ({ id, inMs, outMs: inMs + 4_000, video: "cam", speaker })
  const clip = (...segments: ReturnType<typeof seg>[]) => ({ version: 1, clock: "master", sources: [CAM], segments })

  /** A Camera Switch clips-mode run on the canvas: its batch on `edl`, the one transcript on `transcript`. */
  function pack(clips: unknown[], transcript: unknown, sv: Record<string, unknown> = {}) {
    const nodes = [
      { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Cam", url: CAM.url, metadata: { width: 1920, height: 1080 } } },
      { id: "cs", type: "camera-switch", position: { x: 0, y: 0 }, data: { label: "Camera Switch", __listResults: clips.map((c) => JSON.stringify(c)), generatedJson: { edl: clips[0], transcript } } },
      { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, targetAspect: "9:16", layout: "single", autoRegions: true, ...sv } },
    ] as unknown as WorkflowNode[]
    const edges = [
      { id: "e1", source: "cs", target: "sv", sourceHandle: "edl", targetHandle: "edl" },
      { id: "e2", source: "cs", target: "sv", sourceHandle: "transcript", targetHandle: "transcript" },
    ]
    useWorkflowStore.setState({ nodes, edges, isReadOnly: false } as never)
    const { result } = renderHook(() => useRegionEditor("sv"))
    const data = nodes.find((n) => n.id === "sv")!.data as Record<string, unknown>
    // What each row of the run sends (both engines build this context for a list row).
    const rows = clips.map((c) => speakerViewWireSettings(data, speakerViewContext(c, transcript, { packClip: true })).speakerRegions)
    const panel = speakerViewAutoRegions(data, speakerViewContextOf("sv", nodes, edges as never))
    return { editor: result.current.rows, rows, panel, dirty: result.current.dirty }
  }

  it("every episode speaker on screen in the pack, in episode order: the run, the panel and the editor agree", () => {
    const transcript = { version: 1, words: [
      { text: "hi", startMs: 0, endMs: 400, speaker: "A" },
      { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "B" },
    ] }
    const { editor, rows, panel, dirty } = pack([clip(seg("a0", 10_000, "A"), seg("a1", 14_000, "B")), clip(seg("b0", 30_000, "B"))], transcript)
    expect(rows[0]).toHaveLength(2)
    expect(rows[1]).toEqual(rows[0])
    expect(panel).toEqual(rows[0])
    expect(editor).toEqual(rows[0])
    expect(dirty).toBe(false)
  })

  it("a speaker heard in the episode but in no clip, and a clip where B speaks before A: the editor still deals the run's thirds, in episode order", () => {
    const transcript = { version: 1, words: [
      { text: "hi", startMs: 0, endMs: 400, speaker: "A" },
      { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "B" },
      { text: "so", startMs: 8_000, endMs: 8_400, speaker: "C" },
    ] }
    const { editor, rows, panel, dirty } = pack([clip(seg("a0", 30_000, "B"), seg("a1", 34_000, "A")), clip(seg("b0", 40_000, "A"))], transcript)
    // The run: thirds for A, B, C — the episode's order, C included though no clip shows them.
    expect(rows[0]!.map((r) => r.speaker)).toEqual(["A", "B", "C"])
    expect(rows[1]).toEqual(rows[0])
    expect(panel).toEqual(rows[0])
    // The editor lists who is on screen (C is not), in the clips' order (B first),
    // each in the very box the run sends.
    expect(editor.map((r) => r.speaker)).toEqual(["B", "A"])
    const sent = (speaker: string) => rows[0]!.find((r) => r.speaker === speaker)
    for (const r of editor) expect(r).toEqual(sent(r.speaker))
    expect(editor.find((r) => r.speaker === "A")?.region.x).toBe(0.0085)
    expect(dirty).toBe(false)
  })

  it("a 16:9 output, A and B in the episode, only B on screen: the run draws no box (every box would be the whole frame), and neither does the editor", () => {
    const transcript = { version: 1, words: [
      { text: "hi", startMs: 0, endMs: 400, speaker: "A" },
      { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "B" },
    ] }
    const { editor, rows, panel, dirty } = pack([clip(seg("a0", 30_000, "B")), clip(seg("b0", 40_000, "B"))], transcript, { targetAspect: "16:9" })
    expect(rows).toEqual([undefined, undefined])
    expect(panel).toEqual([])
    expect(editor).toEqual([])
    expect(dirty).toBe(false)
  })

  it("seven speakers in the episode, only B on screen: the run draws full frame (more than six), and so does the editor", () => {
    const transcript = { version: 1, words: ["A", "B", "C", "D", "E", "F", "G"].map((speaker, i) => ({ text: "w", startMs: i * 1_000, endMs: i * 1_000 + 400, speaker })) }
    const { editor, rows, panel, dirty } = pack([clip(seg("a0", 30_000, "B")), clip(seg("b0", 40_000, "B"))], transcript)
    expect(rows).toEqual([undefined, undefined])
    expect(panel).toEqual([])
    expect(editor).toEqual([])
    expect(dirty).toBe(false)
  })

  it("a stray one-word label in the episode (decided 2026-10-18): the run deals halves, and the editor shows the same halves", () => {
    const transcript = { version: 1, words: [
      { text: "hi", startMs: 0, endMs: 60_000, speaker: "A" },
      { text: "um", startMs: 60_000, endMs: 60_300, speaker: "X" },
      { text: "yo", startMs: 61_000, endMs: 121_000, speaker: "B" },
    ] }
    const { editor, rows, panel, dirty } = pack([clip(seg("a0", 130_000, "A"), seg("a1", 134_000, "B")), clip(seg("b0", 140_000, "B"))], transcript)
    expect(rows[0]!.map((r) => r.speaker)).toEqual(["A", "B"])
    expect(rows[1]).toEqual(rows[0])
    expect(panel).toEqual(rows[0])
    expect(editor).toEqual(rows[0])
    expect(dirty).toBe(false)
  })

  it("one speaker on screen in every clip, two in the episode: the editor shows that speaker's third, as the run draws it", () => {
    const transcript = { version: 1, words: [
      { text: "hi", startMs: 0, endMs: 400, speaker: "A" },
      { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "B" },
    ] }
    const { editor, rows, dirty } = pack([clip(seg("a0", 30_000, "B")), clip(seg("b0", 40_000, "B"))], transcript)
    expect(rows[0]!.map((r) => r.speaker)).toEqual(["A", "B"])
    expect(editor).toEqual(rows[0]!.filter((r) => r.speaker === "B"))
    expect(dirty).toBe(false)
  })
})
