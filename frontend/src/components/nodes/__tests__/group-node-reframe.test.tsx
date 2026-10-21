/**
 * The Reframe group (the add-node macro, decided 2026-10-11): it says "Wire a
 * video" until a video reaches it, and carries the ONE summed estimate of its
 * three nodes (D5). A plain group shows neither.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { GroupNode } from "../group-node"
import { planReframeMacro } from "@/lib/reframe-macro"
import { priceFingerprint } from "../macro-group-estimate"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    NodeToolbar: () => null,
    Handle: () => null,
    NodeResizer: () => null,
    useUpdateNodeInternals: vi.fn(() => () => {}),
  }
})
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }))
const credits = vi.hoisted(() => ({ on: true }))
// Video mode (Speaker View AND Speaker Frames priced): live since P3.7; a test
// can withdraw it to see the chip go.
const gate = vi.hoisted(() => ({ live: true }))
vi.mock("@nodaro/render-rules", async (orig) => ({ ...(await orig<typeof import("@nodaro/render-rules")>()), speakerViewVideoModeLive: () => gate.live }))
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => credits.on }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  // No metered key is refused here (the run estimate asks for a refused key).
  isModelRefused: () => false,
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: async () => {},
}))

let mockNodes: any[] = []
let mockEdges: any[] = []
vi.mock("@/hooks/use-workflow-store", () => {
  const state = () => ({ nodes: mockNodes, edges: mockEdges, updateNodeData: vi.fn(), deleteEdge: vi.fn() })
  const useWorkflowStore: any = (selector: any) => selector(state())
  useWorkflowStore.getState = state
  return { useWorkflowStore }
})

afterEach(() => {
  credits.on = true
  gate.live = true
})

function reframe(withVideo: boolean) {
  const plan = planReframeMacro(
    { nodes: [{ id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "V" } } as any], edges: [] },
    {
      position: { x: 500, y: 0 },
      ids: { group: "g", transcribe: "t", frames: "f", view: "v" },
      defaults: { transcribe: { label: "Transcribe" }, frames: { label: "Speaker Frames" }, view: { label: "Speaker View" } },
      ...(withVideo ? { video: { source: "up", sourceHandle: "video" } } : {}),
    },
  )
  mockNodes = plan.nodes
  mockEdges = plan.edges
  return plan.nodes.find((n: any) => n.type === "group")!
}

const renderGroup = (node: any) => render(<GroupNode {...({ id: node.id, data: node.data, selected: false } as any)} />)

describe("a Reframe group", () => {
  it("says 'Wire a video' while no video is wired into its nodes", () => {
    renderGroup(reframe(false))
    expect(screen.getByTestId("reframe-wire-video").textContent).toBe("Wire a video")
  })

  it("drops the badge once a video is wired", () => {
    renderGroup(reframe(true))
    expect(screen.queryByTestId("reframe-wire-video")).toBeNull()
  })

  it("carries one estimate for its three nodes (D5), Speaker Frames priced since P3.7", () => {
    renderGroup(reframe(true))
    expect(screen.getAllByTestId("macro-group-estimate")).toHaveLength(1)
    expect(screen.getByTestId("macro-group-estimate").textContent).toMatch(/^≈ \d/)
  })

  it("shows no estimate should a price be withdrawn (video mode not live)", () => {
    gate.live = false
    renderGroup(reframe(true))
    expect(screen.queryByTestId("macro-group-estimate")).toBeNull()
  })

  it("shows no estimate on an edition without credits", () => {
    credits.on = false
    renderGroup(reframe(true))
    expect(screen.queryByTestId("macro-group-estimate")).toBeNull()
  })
})

describe("a plain group", () => {
  it("shows neither the badge nor an estimate", () => {
    mockNodes = [{ id: "pg", type: "group", position: { x: 0, y: 0 }, data: { label: "Mine" } }]
    mockEdges = []
    renderGroup(mockNodes[0])
    expect(screen.queryByTestId("reframe-wire-video")).toBeNull()
    expect(screen.queryByTestId("macro-group-estimate")).toBeNull()
  })
})

describe("the estimate chip re-renders only when the group's price could change", () => {
  it("ignores an unrelated node moving or changing, and sees a child's setting or a new wire", () => {
    reframe(true)
    const base = priceFingerprint("g", mockNodes, mockEdges)
    const other = { id: "o", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "x" } }
    expect(priceFingerprint("g", [...mockNodes, other], mockEdges)).toBe(base)
    expect(priceFingerprint("g", mockNodes.map((n) => (n.id === "up" ? { ...n, position: { x: 9, y: 9 } } : n)), mockEdges)).toBe(base)
    expect(priceFingerprint("g", mockNodes.map((n) => (n.id === "v" ? { ...n, data: { ...n.data, quality: "proxy" } } : n)), mockEdges)).not.toBe(base)
    // What feeds the group counts too: an upload's saved length prices a render.
    expect(priceFingerprint("g", mockNodes.map((n) => (n.id === "up" ? { ...n, data: { ...n.data, durationSec: 60 } } : n)), mockEdges)).not.toBe(base)
    expect(priceFingerprint("g", mockNodes, mockEdges.slice(1))).not.toBe(base)
  })

  it("covers EVERYTHING upstream of the group, not only the nodes wired straight into it (decided 2026-10-12)", () => {
    // deep -> mid -> up -> (the group's three inputs): a Trim's settings, or an Upload's
    // saved length two hops up, move the render's price just as much.
    reframe(true)
    const deep = { id: "deep", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Deep" } }
    const mid = { id: "mid", type: "trim-video", position: { x: 0, y: 0 }, data: { label: "Mid" } }
    const nodes = [...mockNodes, deep, mid]
    const edges = [...mockEdges, { id: "d-m", source: "deep", target: "mid", sourceHandle: "video", targetHandle: "video" }, { id: "m-u", source: "mid", target: "up", sourceHandle: "video", targetHandle: "video" }]
    const base = priceFingerprint("g", nodes, edges)
    expect(priceFingerprint("g", nodes.map((n) => (n.id === "deep" ? { ...n, data: { ...n.data, durationSec: 90 } } : n)), edges)).not.toBe(base)
    expect(priceFingerprint("g", nodes.map((n) => (n.id === "mid" ? { ...n, data: { ...n.data, endTime: 5 } } : n)), edges)).not.toBe(base)
    expect(priceFingerprint("g", nodes, edges.filter((e) => e.id !== "d-m"))).not.toBe(base)
    // Still blind to what is not upstream, and to a move.
    const stray = { id: "stray", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "S" } }
    expect(priceFingerprint("g", [...nodes, stray], [...edges, { id: "s-x", source: "stray", target: "other", sourceHandle: "video", targetHandle: "video" }])).toBe(base)
    expect(priceFingerprint("g", nodes.map((n) => (n.id === "deep" ? { ...n, position: { x: 7, y: 7 } } : n)), edges)).toBe(base)
  })

  it("terminates on a cycle upstream", () => {
    reframe(true)
    const edges = [...mockEdges, { id: "loop", source: "up", target: "up", sourceHandle: "video", targetHandle: "video" }]
    expect(() => priceFingerprint("g", mockNodes, edges)).not.toThrow()
  })

  it("never serialises node data: a megabyte transcript costs nothing per store update", () => {
    // The selector runs on EVERY store update (every drag frame), so the cost of
    // the fingerprint is paid per frame for as long as a Reframe group exists.
    reframe(true)
    const big = { words: Array.from({ length: 50_000 }, (_, i) => ({ text: `w${i}`, start: i, end: i + 1 })) }
    const nodes = mockNodes.map((n) => (n.type === "transcribe" ? { ...n, data: { ...n.data, generatedJson: big } } : n))
    const spy = vi.spyOn(JSON, "stringify")
    try {
      const base = priceFingerprint("g", nodes, mockEdges)
      // A drag: new node objects, the same data objects.
      const dragged = nodes.map((n) => ({ ...n, position: { x: 1, y: 2 } }))
      expect(priceFingerprint("g", dragged, mockEdges)).toBe(base)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it("sees a replaced data object on a child or on what feeds it, even one structurally equal", () => {
    reframe(true)
    const base = priceFingerprint("g", mockNodes, mockEdges)
    expect(priceFingerprint("g", mockNodes.map((n) => (n.id === "v" ? { ...n, data: { ...n.data } } : n)), mockEdges)).not.toBe(base)
    expect(priceFingerprint("g", mockNodes.map((n) => (n.id === "up" ? { ...n, data: { ...n.data } } : n)), mockEdges)).not.toBe(base)
  })
})
