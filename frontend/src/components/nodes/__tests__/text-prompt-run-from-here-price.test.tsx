/**
 * The Text node's "Run from here" price is a run-set price like every other:
 * a UGC part whose server figure is not in, or could not be had, is marked as
 * an estimate and says why on hover; once the figure lands it is plain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({ estimate: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ugcEstimateApi: (...a: unknown[]) => h.estimate(...a),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: async () => undefined,
}))
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), hasCredits: () => true }))
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: () => null,
    NodeResizer: () => null,
    NodeResizeControl: () => null,
    NodeToolbar: ({ children, isVisible }: { children: React.ReactNode; isVisible: boolean }) => (isVisible ? <div data-testid="node-toolbar">{children}</div> : null),
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "site"),
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
    useConnection: vi.fn(() => ({ inProgress: false })),
    useUpdateNodeInternals: vi.fn(() => () => {}),
  }
})
vi.mock("@/hooks/use-workflow-store", () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
  const state = {
    updateNodeData: () => {},
    runFromHere: () => {},
    // The product name on a Text node, read by UGC Script.
    nodes: [node("site", "text-prompt", { text: "Acme" }), node("script", "ugc-script", { targetDurationSec: 15 })],
    edges: [{ id: "e1", source: "site", target: "script", targetHandle: "site" }],
  }
  return { useWorkflowStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) }
})

import { TextPromptNode } from "../text-prompt-node"
import { queryClient } from "@/lib/query-client"

const PARTS = { script: 20, creator: 0, clip: 0, cards: 0, join: 0, overlay: 0, captions: 0 }
const ANSWER = { lines: [], expected: 20, ceiling: 20, range: [20, 20], worstCase: 20, parts: PARTS, holdParts: PARTS }

beforeEach(() => {
  queryClient.clear()
  h.estimate.mockReset()
})
afterEach(() => queryClient.clear())

const props = { id: "site", data: { label: "site", text: "Acme" }, selected: true } as unknown as Parameters<typeof TextPromptNode>[0]
const renderSelected = () => render(<TextPromptNode {...props} />)

describe("the Text node's Run from here price", () => {
  it("while the video's price is on its way: marked, and why on hover; then the server's figure, plain", async () => {
    let land!: (v: unknown) => void
    h.estimate.mockReturnValue(new Promise((resolve) => { land = resolve }))
    renderSelected()
    const marked = await screen.findByText(/\(\d+ CR, estimate\)/)
    expect(marked.getAttribute("title")).toBe("Checking the video's price. Until it arrives, this is the editor's own estimate.")
    land(ANSWER)
    await waitFor(() => expect(screen.getByText("(20 CR)")).toBeTruthy())
    expect(screen.getByText("(20 CR)").getAttribute("title")).toBeNull()
  })

  it("when it cannot be had: still marked, saying so", async () => {
    h.estimate.mockRejectedValue(new Error("503"))
    renderSelected()
    await waitFor(() =>
      expect(screen.getByText(/\(\d+ CR, estimate\)/).getAttribute("title")).toBe(
        "The video's price could not be checked. This is the editor's own estimate, and the video may cost more.",
      ),
    )
  })
})
