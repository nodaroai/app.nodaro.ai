/**
 * The Apply EDL config panel's badge (A2b): the panel reads, from the canvas,
 * the EDL the node would render now and its wired sources, and the badge judges
 * them with Apply EDL's render rule and the node's own settings. These render
 * the real panel over a store holding the canvas; the verdicts themselves are
 * pinned against the server in lib/__tests__/apply-edl-render-rule-parity.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

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

  // Decided 2026-10-05: a List wired into Sources fans the render out, one
  // render per row with that row's media; the badge judges every one of them.
  it("judges each render of a List wired into Sources: a row missing a camera is flagged by its number", async () => {
    const twoCams = edlOf(
      [{ id: "cam", url: "", kind: "video" }, { id: "cam2", url: "", kind: "video" }],
      [seg("s0", 0, 3000, { video: "cam" }), seg("s1", 3000, 6000, { video: "cam2" })],
    )
    store.nodes = [
      { id: "plan", type: "edit-plan", data: { generatedJson: twoCams } },
      {
        id: "cams",
        type: "list",
        data: {
          columns: [
            { id: "a", name: "A", handleId: "col_a", type: "text" },
            { id: "b", name: "B", handleId: "col_b", type: "text" },
          ],
          rows: [["https://media.test/a0.mp4", "https://media.test/b0.mp4"], ["https://media.test/a1.mp4", ""]],
        },
      },
      { id: "render", type: "apply-edl", data: {} },
    ]
    store.edges = [
      { id: "e-edl", source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" },
      { id: "e-a", source: "cams", sourceHandle: "col_a", target: "render", targetHandle: "sources" },
      { id: "e-b", source: "cams", sourceHandle: "col_b", target: "render", targetHandle: "sources" },
    ]
    render(
      <ApplyEdlConfig
        data={{} as ApplyEdlData}
        onUpdate={() => {}}
        sources={[]}
        fieldMappings={{}}
        onMapField={() => {}}
        nodes={[]}
        nodeId="render"
      />,
    )
    const badge = screen.getByTestId("edl-validity-badge")
    expect(badge.dataset.ok).toBe("false")
    expect(badge.textContent).toContain("Issues in 1 of 2 renders")
    await userEvent.click(badge)
    const failing = await screen.findAllByTestId("edl-render-issues")
    expect(failing).toHaveLength(1)
    expect(failing[0]!.textContent).toContain("Render 2")
    expect(failing[0]!.textContent).toMatch(/source "cam2" has no url/)
  })
})

// U6 (SV16 b): an edit Apply EDL refuses for a Speaker View feature offers the
// swap under its issues, saying what it keeps and drops; a swap that would be
// refused shows its reason, disabled, before anything changes.
describe("the badge offers 'Replace with Speaker View' on a hinted edit (U6)", () => {
  const hinted = edlOf([CAM, CAM2], [
    seg("s0", 0, 3000, { video: "cam" }),
    seg("s1", 3000, 6000, { video: "cam", layout: { mode: "side-by-side", slots: [{ source: "cam" }, { source: "cam2" }] } }),
  ])

  it("under the issues: the action and what it keeps and drops", async () => {
    await userEvent.click(canvas(hinted, {}, { uploadUrl: "https://media.test/up.mp4" }))
    const action = await screen.findByTestId("replace-render-node")
    expect(action.textContent).toContain("Replace with Speaker View")
    expect(action.textContent).toContain("keeps the edl wires; drops 1 sources wire; one undo step")
    expect(action.querySelector("button")!.disabled).toBe(false)
  })

  it("the confirm opens over the popover, lists every wire and says the history is not carried", async () => {
    await userEvent.click(canvas(hinted, {}, { uploadUrl: "https://media.test/up.mp4" }))
    await userEvent.click(within(await screen.findByTestId("replace-render-node")).getByRole("button"))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("Replace Apply EDL with Speaker View?")
    expect(dialog.textContent).toContain("Preview and Final history is not carried")
    expect(dialog.textContent).toContain("Edit Plan → edl")
    expect(dialog.textContent).toContain("Upload Video → sources")
  })

  it("an audio-only render: disabled, with the reason", async () => {
    await userEvent.click(canvas(hinted, { output: "audio" }))
    const action = await screen.findByTestId("replace-render-node")
    expect(action.querySelector("button")!.disabled).toBe(true)
    expect(action.textContent).toContain("Speaker View has no audio-only render")
  })

  it("not offered for an issue Speaker View does not fix", async () => {
    const ghost = edlOf([CAM], [seg("s0", 0, 4000, { video: "ghost" })])
    await userEvent.click(canvas(ghost))
    expect(screen.queryByTestId("replace-render-node")).toBeNull()
  })
})
