/**
 * The region editor while face tracks are wired: faces win (decided
 * 2026-10-13). A speaker a track names is followed by their face, so the
 * editor deals them no default box — it opens clean with nothing touched,
 * and Save never writes a row for them. A speaker no track names keeps the
 * very third the run sends ("Split the camera by speaker").
 */
import { afterEach, describe, expect, it, vi } from "vitest"

// The track body is never needed here (the boxes on the frame); keep the hook off the network.
vi.mock("@/lib/speaker-track-body", async (orig) => ({ ...(await orig<typeof import("@/lib/speaker-track-body")>()), readSpeakerTrackBody: () => new Promise(() => {}) }))
import { act, renderHook } from "@testing-library/react"
import { speakerViewWireSettings } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { speakerViewContextOf } from "@/lib/speaker-view-context"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useRegionEditor } from "../use-region-editor"
import { useRegionTracks } from "../use-region-tracks"

const CAM = { id: "cam", url: "https://cdn/cam.mp4", kind: "video" }
const EDL = {
  version: 1, clock: "master", sources: [CAM],
  segments: [
    { id: "s0", inMs: 0, outMs: 5_000, video: "cam", speaker: "Host" },
    { id: "s1", inMs: 5_000, outMs: 9_000, video: "cam", speaker: "Guest" },
  ],
}
const named = (id: string, speaker: string) => ({ id, boxCount: 3, speaker, attribution: { method: "mouth-motion", confidence: 0.9, rawSpeaker: speaker } })
const tracksOf = (tracks: unknown[]) => ({
  version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://cdn/speaker-tracks/11111111-2222-4333-8444-555555555555.json", sha256: "a".repeat(64), bytes: 10,
  sources: [{ sourceId: "cam", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 9_000 }], tracks }],
})

function seed(sv: Record<string, unknown>, tracks?: unknown) {
  const nodes = [
    { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Cam", url: CAM.url, metadata: { width: 1920, height: 1080 } } },
    ...(tracks ? [{ id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data: { label: "Speaker Frames", generatedJson: tracks } }] : []),
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", fieldMappings: {}, targetAspect: "9:16", layout: "single", edl: EDL, ...sv } },
  ] as unknown as WorkflowNode[]
  const edges = (tracks ? [{ id: "t", source: "sf", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" }] : []) as unknown as WorkflowEdge[]
  useWorkflowStore.setState({ nodes, edges, isReadOnly: false } as never)
}
const runRows = () => {
  const { nodes, edges } = useWorkflowStore.getState()
  const data = nodes.find((n) => n.id === "sv")!.data as Record<string, unknown>
  return speakerViewWireSettings(data, speakerViewContextOf("sv", nodes, edges)).speakerRegions ?? []
}
const svData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "sv")!.data as Record<string, unknown>

afterEach(() => useWorkflowStore.setState({ nodes: [], edges: [] } as never))

describe("the region editor with face tracks wired (faces win)", () => {
  it("with Split the camera on and Host tracked: opens clean, deals Host no box, and Guest's box is the run's row", () => {
    seed({ autoRegions: true }, tracksOf([named("cam/t1", "Host")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.dirty).toBe(false)
    const cam = result.current.model.cameras[0]!
    expect(result.current.regionOf(cam, "Host")).toBeNull()
    expect(result.current.rows).toEqual(runRows())
    expect(result.current.rows).toEqual([{ source: "cam", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } }])
  })

  it("Save writes no row for a tracked speaker", () => {
    seed({ autoRegions: true }, tracksOf([named("cam/t1", "Host")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    act(() => result.current.save())
    const rows = svData().speakerRegions as Array<{ speaker: string }>
    expect(rows.map((r) => r.speaker)).toEqual(["Guest"])
  })

  it("every speaker tracked: nothing to save, nothing dirty", () => {
    seed({ autoRegions: true }, tracksOf([named("cam/t1", "Host"), named("cam/t2", "Guest")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.dirty).toBe(false)
    expect(result.current.rows).toEqual([])
    act(() => result.current.save())
    expect(svData().speakerRegions).toBeUndefined()
  })

  it("without the switch, a tracked speaker still gets no default box (it is followed); the untracked one's default is unsaved as before", () => {
    seed({}, tracksOf([named("cam/t1", "Host")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    const cam = result.current.model.cameras[0]!
    expect(result.current.regionOf(cam, "Host")).toBeNull()
    expect(result.current.rows.map((r) => r.speaker)).toEqual(["Guest"])
    expect(result.current.dirty).toBe(true)
  })

  it("a box the person draws for a tracked speaker is kept and saved", () => {
    seed({ autoRegions: true }, tracksOf([named("cam/t1", "Host")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    act(() => result.current.setBox(JSON.stringify(["cam", "Host"]), { x: 0.1, y: 0, w: 0.3, h: 1 }))
    expect(result.current.rows.find((r) => r.speaker === "Host")?.region).toEqual({ x: 0.1, y: 0, w: 0.3, h: 1 })
  })

  it("without tracks: every speaker gets their default, as before", () => {
    seed({ autoRegions: true })
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.rows.map((r) => r.speaker)).toEqual(["Host", "Guest"])
    expect(result.current.dirty).toBe(false)
  })
})

describe("the dialog's staged face corrections (tap-first), legacy rows and Swap", () => {
  /** The dialog's wiring: the staged corrections feed the editor. */
  const dialog = () =>
    renderHook(() => {
      const tracks = useRegionTracks("sv", undefined)
      const ed = useRegionEditor("sv", tracks.labelled)
      return { tracks, ed }
    })

  it("picking Host's face: Host's box goes at once, Save writes no Host row, Guest's row is the run's", () => {
    seed({ autoRegions: true }, tracksOf([{ id: "cam/t1", boxCount: 3 }, { id: "cam/t2", boxCount: 3 }]))
    const { result } = dialog()
    const cam = () => result.current.ed.model.cameras[0]!
    expect(result.current.ed.rows.map((r) => r.speaker)).toEqual(["Host", "Guest"])
    expect(result.current.ed.dirty).toBe(false)
    act(() => result.current.tracks.assign("cam/t1", "Host"))
    expect(result.current.ed.regionOf(cam(), "Host")).toBeNull()
    act(() => {
      result.current.ed.save()
      result.current.tracks.save()
    })
    expect((svData().speakerRegions as Array<{ speaker: string }>).map((r) => r.speaker)).toEqual(["Guest"])
    const guest = (svData().speakerRegions as Array<{ speaker: string; region: unknown }>)[0]!
    expect(guest.region).toEqual({ x: 0.5918, y: 0, w: 0.3164, h: 1 })
    // Host is now tracked by the saved correction; the run sends no box for them.
    expect(runRows().map((r) => r.speaker)).toEqual(["Guest"])
  })

  it("a row saved earlier as an untouched default, for a speaker a track now names, is dropped at Save", () => {
    const hostDefault = { source: "cam", speaker: "Host", region: { x: 0.0918, y: 0, w: 0.3164, h: 1 } }
    const guestDefault = { source: "cam", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } }
    seed({ speakerRegions: [hostDefault, guestDefault], defaultRegionKeys: [JSON.stringify(["cam", "Host"]), JSON.stringify(["cam", "Guest"])] }, tracksOf([named("cam/t1", "Host")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.regionOf(result.current.model.cameras[0]!, "Host")).toBeNull()
    act(() => result.current.save())
    expect(svData().speakerRegions).toEqual([guestDefault])
  })

  it("a box the person drew or moved for a now-tracked speaker is kept", () => {
    const hostDrawn = { source: "cam", speaker: "Host", region: { x: 0.12, y: 0, w: 0.3, h: 1 } }
    const guestDefault = { source: "cam", speaker: "Guest", region: { x: 0.5918, y: 0, w: 0.3164, h: 1 } }
    seed({ speakerRegions: [hostDrawn, guestDefault], defaultRegionKeys: [JSON.stringify(["cam", "Guest"])] }, tracksOf([named("cam/t1", "Host")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    act(() => result.current.save())
    expect(svData().speakerRegions).toEqual([hostDrawn, guestDefault])
  })

  it("Swap is off on a camera with a tracked speaker, and does nothing there", () => {
    seed({ autoRegions: true }, tracksOf([named("cam/t1", "Host")]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.canSwap).toBe(false)
    const before = result.current.rows
    act(() => result.current.swap())
    expect(result.current.rows).toEqual(before)
  })

  it("Swap is on with no speaker tracked, and trades the two boxes", () => {
    seed({ autoRegions: true }, tracksOf([{ id: "cam/t1", boxCount: 3 }]))
    const { result } = renderHook(() => useRegionEditor("sv"))
    expect(result.current.canSwap).toBe(true)
    act(() => result.current.swap())
    expect(result.current.rows.map((r) => [r.speaker, r.region.x])).toEqual([["Host", 0.5918], ["Guest", 0.0918]])
  })
})
