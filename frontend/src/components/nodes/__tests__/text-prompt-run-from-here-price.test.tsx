/**
 * The Text node's "Run from here" price is a run-set price like every other:
 * a UGC part whose server figure is not in, or could not be had, is marked as
 * an estimate and says why on hover; once the figure lands it is plain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  estimate: vi.fn(),
  /** Metered keys the server refused to price, with its sentence. */
  refused: new Map<string, string>(),
  /** Metered keys the server answered as estimates, at their figures. */
  estimates: new Map<string, number>(),
  /** The graph, when a test swaps it (stable references: the store selector returns them as is). */
  graph: null as { nodes: unknown[]; edges: unknown[] } | null,
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ugcEstimateApi: (...a: unknown[]) => h.estimate(...a),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  // A metered key is refused, or answered as an estimate, only where a test says so.
  isModelRefused: (id: string) => h.refused.has(id),
  refusedModelMessage: (id: string) => h.refused.get(id),
  isModelEstimate: (id: string) => h.estimates.has(id),
  getCachedModelCredits: (id: string) => h.estimates.get(id),
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
  // The product name on a Text node, read by UGC Script.
  const nodes = [node("site", "text-prompt", { text: "Acme" }), node("script", "ugc-script", { targetDurationSec: 15 })]
  const edges = [{ id: "e1", source: "site", target: "script", targetHandle: "site" }]
  const state = {
    updateNodeData: () => {},
    runFromHere: () => {},
    get nodes() { return h.graph?.nodes ?? nodes },
    get edges() { return h.graph?.edges ?? edges },
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
  h.refused.clear()
  h.estimates.clear()
  h.graph = null
})
afterEach(() => queryClient.clear())

const props = { id: "site", data: { label: "site", text: "Acme" }, selected: true } as unknown as Parameters<typeof TextPromptNode>[0]
const renderSelected = () => render(<TextPromptNode {...props} />)

describe("the Text node's Run from here price", () => {
  it("while the video's price is on its way: marked, and why on hover; then the server's figure, plain", async () => {
    let land!: (v: unknown) => void
    h.estimate.mockReturnValue(new Promise((resolve) => { land = resolve }))
    renderSelected()
    // `~` before an estimate, as the Execute button shows one.
    const marked = await screen.findByText(/^\(~\d+ CR\)$/)
    expect(marked.getAttribute("title")).toBe("Checking the video's price. Until it arrives, this is the editor's own estimate.")
    land(ANSWER)
    await waitFor(() => expect(screen.getByText("(20 CR)")).toBeTruthy())
    expect(screen.getByText("(20 CR)").getAttribute("title")).toBeNull()
  })

  it("when it cannot be had: still marked, saying so", async () => {
    h.estimate.mockRejectedValue(new Error("503"))
    renderSelected()
    await waitFor(() =>
      expect(screen.getByText(/^\(~\d+ CR\)$/).getAttribute("title")).toBe(
        "The video's price could not be checked. This is the editor's own estimate, and the video may cost more.",
      ),
    )
  })
})

describe("the Text node's Run from here price with a metered LLM node downstream", () => {
  const KEY = "llm-chat:claude-opus-5.5"
  const chatGraph = () => {
    const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
    return {
      nodes: [node("site", "text-prompt", { text: "Acme" }), node("chat", "llm-chat", { llmModel: "claude-opus-5.5" })],
      edges: [{ id: "e1", source: "site", target: "chat", targetHandle: "prompt" }],
    }
  }

  it("an estimate reads `~N`, like the Execute button", async () => {
    h.graph = chatGraph()
    h.estimates.set(KEY, 6)
    renderSelected()
    const price = await screen.findByText("(~6 CR)")
    expect(price.getAttribute("title")).toBeNull()
  })

  it("a model the server refuses to price: no figure, \"not priced yet\", the server's sentence on hover", async () => {
    const message = 'The model "claude-opus-5.5" has no price yet, so it cannot be run. Choose another model.'
    h.graph = chatGraph()
    h.refused.set(KEY, message)
    renderSelected()
    const price = await screen.findByText("(not priced yet)")
    expect(price.getAttribute("title")).toBe(message)
  })
})
