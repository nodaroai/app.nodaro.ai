/**
 * "Split the camera by speaker" (`autoRegions`, decided 2026-10-13) renders the
 * very boxes the region editor starts from: the run's `speakerViewAutoRegions`
 * equals what the editor shows (and Save would write) for a never-framed node,
 * on edits where the edit's own speaker list and who is on screen differ.
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
