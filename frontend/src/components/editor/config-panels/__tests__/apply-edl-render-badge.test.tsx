/**
 * The Apply EDL config panel's badge (A2b): the panel reads, from the canvas,
 * the EDL the node would render now and its wired sources, and the badge judges
 * them with Apply EDL's render rule and the node's own settings. These render
 * the real panel over a store holding the canvas; the verdicts themselves are
 * pinned against the server in lib/__tests__/apply-edl-render-rule-parity.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

const { store } = vi.hoisted(() => {
  const store = {
    nodes: [] as Array<{ id: string; type: string; data: Record<string, unknown> }>,
    edges: [] as Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>,
  }
  return { store }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (select: (s: typeof store) => unknown) => select(store),
    { getState: () => store },
  ),
}))

import { ApplyEdlConfig } from "../processing-configs"
import type { ApplyEdlData } from "@/types/nodes"

const seg = (id: string, inMs: number, outMs: number, more: Record<string, unknown> = {}) => ({ id, inMs, outMs, ...more })
const CAM = { id: "cam", url: "https://media.test/cam.mp4", kind: "video" }
const CAM2 = { id: "cam2", url: "https://media.test/cam2.mp4", kind: "video" }
const MIC = { id: "mic", url: "https://media.test/mic.wav", kind: "audio", role: "master-audio" }
const edlOf = (sources: unknown[], segments: unknown[]) => ({ version: 1, clock: "master", sources, segments })

function canvas(plan: unknown, data: Partial<ApplyEdlData> = {}, extra: { uploadUrl?: string } = {}) {
  store.nodes = [
    { id: "plan", type: "edit-plan", data: { generatedJson: plan } },
    ...(extra.uploadUrl !== undefined ? [{ id: "upload", type: "upload-video", data: { url: extra.uploadUrl } }] : []),
    { id: "render", type: "apply-edl", data: data as Record<string, unknown> },
  ]
  store.edges = [
    { id: "e-edl", source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" },
    ...(extra.uploadUrl !== undefined ? [{ id: "e-src", source: "upload", target: "render", targetHandle: "sources" }] : []),
  ]
  render(
    <ApplyEdlConfig
      data={data as ApplyEdlData}
      onUpdate={() => {}}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[]}
      nodeId="render"
    />,
  )
  return screen.getByTestId("edl-validity-badge")
}

afterEach(() => cleanup())

describe("the Apply EDL panel badge judges what the node would render", () => {
  it("a plan this renderer draws reads 'Ready to render'", () => {
    const badge = canvas(edlOf([CAM], [seg("s0", 0, 4000, { video: "cam" })]))
    expect(badge.dataset.mode).toBe("render")
    expect(badge.textContent).toContain("Ready to render")
  })

  it("a well-formed plan with a layout is refused, as the render refuses it", () => {
    const layout = edlOf([CAM, CAM2], [
      seg("s0", 0, 3000, { video: "cam" }),
      seg("s1", 3000, 6000, { video: "cam", layout: { mode: "side-by-side", slots: [{ source: "cam" }, { source: "cam2" }] } }),
    ])
    const badge = canvas(layout)
    expect(badge.dataset.ok).toBe("false")
    expect(badge.textContent).toContain("2 EDL issues")
  })

  it("uses the node's Output: a segment with no picture fails a video render, not an audio one", () => {
    const noPicture = edlOf([CAM, MIC], [seg("s0", 0, 4000, { video: "cam" }), seg("s1", 4000, 6000)])
    expect(canvas(noPicture, { output: "video" }).dataset.ok).toBe("false")
    cleanup()
    expect(canvas(noPicture, { output: "audio" }).textContent).toContain("Ready to render")
  })

  it("uses the node's Default crossfade: it can bring an edit under the 180-minute cap", () => {
    const MIN = 60_000
    const justOver = edlOf([CAM], [
      seg("a", 0, 60 * MIN, { video: "cam" }),
      seg("b", 60 * MIN, 120 * MIN, { video: "cam" }),
      seg("c", 120 * MIN, 180 * MIN + 2000, { video: "cam" }),
    ])
    expect(canvas(justOver, { crossfadeMs: 0 }).dataset.ok).toBe("false")
    cleanup()
    expect(canvas(justOver, { crossfadeMs: 1000 }).textContent).toContain("Ready to render")
  })

  it("uses the wired Sources: an empty url a wired upload fills renders", () => {
    const unresolved = edlOf([{ id: "cam", url: "", kind: "video" }], [seg("s0", 0, 4000, { video: "cam" })])
    expect(canvas(unresolved).dataset.ok).toBe("false")
    cleanup()
    expect(canvas(unresolved, {}, { uploadUrl: "https://media.test/upload.mp4" }).textContent).toContain("Ready to render")
  })
})
