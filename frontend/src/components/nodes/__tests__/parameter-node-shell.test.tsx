/**
 * Tests for `ParameterNodeShell`'s typed source-pip dispatch:
 *
 *  - When the node's `type` is a registered picker (e.g. "mood",
 *    "atmosphere"), the shell MUST render `<HandleWithPopover>` with the
 *    picker family's color (the `getPickerOutputMeta(type)` lookup).
 *  - When the node's `type` is NOT in the picker registry (e.g. "tone"),
 *    the shell MUST fall back to the legacy `<HandleIcon>`.
 *
 * The dispatch decision is the unit under test — both `HandleWithPopover`
 * and `HandleIcon` are mocked to lightweight probes so we can assert the
 * branch was taken with the expected props (including the family color
 * pulled from the registry).
 *
 * The shell finds its own node via `useWorkflowStore`'s `nodes` array
 * (`nodes.find(n => n.id === id)`), so each test seeds a mock store entry
 * whose `id` matches the rendered node prop and whose `type` selects the
 * branch we're exercising.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mutable mock state — re-assigned per test before render to vary the
// node `type` (which drives the dispatch in ParameterNodeShell).
// ---------------------------------------------------------------------------

let mockNodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = []

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => vi.fn()),
  useConnection: vi.fn(() => ({ inProgress: false })),
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => <div data-testid="editable-node-label">{label}</div>,
}))

// Lightweight probe — captures the props we care about (color, nodeType)
// so the dispatch branch is assertable from the DOM. The real component
// pulls in Radix Popover + a lazy-loaded HandlePopover which we don't
// need for this test.
vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: ({ color, nodeType, label, handleId }: any) => (
    <div
      data-testid="handle-with-popover"
      data-color={color}
      data-node-type={nodeType}
      data-label={label}
      data-handle-id={handleId}
    />
  ),
}))

vi.mock("../handle-icon", () => ({
  HandleIcon: ({ color }: any) => (
    <div data-testid="handle-icon" data-color={color} />
  ),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, handles }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      // Expose the `handles` prop so tests can assert on the source entry's
      // `external` flag. This is the contract between ParameterNodeShell and
      // BaseNode: when `external` is false, BaseNode renders a real <Handle>
      // (visible-but-hidden) so drag-to-connect works; when `external` is
      // true, BaseNode skips rendering and HandleWithPopover owns the pip.
      data-handles={JSON.stringify(
        (handles ?? []).map((h: any) => ({
          id: h.id,
          type: h.type,
          external: h.external ?? false,
        })),
      )}
    >
      {children}
    </div>
  ),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => (
    <div data-testid="run-node-button" data-credits={props.credits} />
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return {
    Smile: I, Palette: I, CloudFog: I, Eye: I, FileText: I, Layers: I,
    // picker-handles registry icons (transitively loaded)
    Aperture: I, Lightbulb: I, Cloud: I, Wind: I, Shirt: I, PersonStanding: I,
    Frame: I, Sparkle: I, Camera: I, Brush: I, Sparkles: I, MapPin: I, Zap: I,
    Repeat: I, Bot: I, Car: I, Crosshair: I, Sofa: I, Hand: I, Box: I,
    Activity: I, Film: I, Scissors: I, Music: I, Mic: I,
  }
})

vi.mock("@/components/editor/config-panels/mood-emoji", () => ({
  MoodEmoji: () => <div data-testid="mood-emoji" />,
}))

vi.mock("@/components/editor/config-panels/atmosphere-preview", () => ({
  AtmospherePreview: () => <div data-testid="atmosphere-preview" />,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  EXECUTION_DATA_KEYS: new Set(["executionStatus"]),
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        updateNode: () => {},
        runFromHere: () => {},
        nodes: mockNodes,
        edges: [],
        loadGeneration: 0,
      }),
    { getState: () => ({ nodes: mockNodes, edges: [] }) },
  ),
}))

// ---------------------------------------------------------------------------
// Component imports (after all mocks)
// ---------------------------------------------------------------------------

import { MoodNode } from "../mood-node"
import { AtmosphereNode } from "../atmosphere-node"
import { ToneNode } from "../tone-node"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ParameterNodeShell — typed source pip dispatch", () => {
  it("renders typed pip with mood's family color when nodeType is 'mood'", () => {
    // Seed the store so the shell's `nodes.find(n => n.id === id)` resolves
    // to a node whose `type` is "mood" — a registered picker in the "look"
    // family with the indigo color #818CF8.
    mockNodes = [{ id: "node-1", type: "mood", data: { label: "Mood", mood: "calm" } }]

    render(
      <MoodNode
        id="node-1"
        data={{ label: "Mood", mood: "calm" } as any}
        selected={false}
        type="mood"
        {...({} as any)}
      />,
    )

    const pip = screen.getByTestId("handle-with-popover")
    expect(pip).toBeInTheDocument()
    // Color comes from `getPickerOutputMeta("mood").color` — the look family's
    // indigo (#818CF8). This is the load-bearing assertion: the registry
    // lookup happened and the color flowed into HandleWithPopover.
    expect(pip).toHaveAttribute("data-color", "#818CF8")
    expect(pip).toHaveAttribute("data-node-type", "mood")
    // And the fallback HandleIcon should NOT be rendered (mutually
    // exclusive — the shell picks one or the other).
    expect(screen.queryByTestId("handle-icon")).not.toBeInTheDocument()
  })

  it("renders typed pip with atmosphere's family color when nodeType is 'atmosphere'", () => {
    // Second positive case to confirm the dispatch is data-driven (not
    // hard-coded for mood). Atmosphere is also in the "look" family →
    // same indigo color.
    mockNodes = [
      { id: "node-1", type: "atmosphere", data: { label: "Atmosphere", atmosphere: "clear" } },
    ]

    render(
      <AtmosphereNode
        id="node-1"
        data={{ label: "Atmosphere", atmosphere: "clear" } as any}
        selected={false}
        type="atmosphere"
        {...({} as any)}
      />,
    )

    const pip = screen.getByTestId("handle-with-popover")
    expect(pip).toHaveAttribute("data-color", "#818CF8")
    expect(pip).toHaveAttribute("data-node-type", "atmosphere")
    expect(screen.queryByTestId("handle-icon")).not.toBeInTheDocument()
  })

  it("falls back to HandleIcon when nodeType is NOT in the picker registry", () => {
    // Synthesize a node type that is intentionally NOT in
    // `picker-handles.ts`'s REGISTRY to exercise the fallback path. (Tone
    // and text-prompt — formerly fallback cases — were added to the
    // registry as non-tile-grid hint producers, so a synthetic type is
    // needed to keep this assertion meaningful.)
    mockNodes = [{ id: "node-1", type: "__unknown-fallback-type__", data: { label: "Unknown" } }]

    render(
      <ToneNode
        id="node-1"
        data={{ label: "Tone", tone: "calm" } as any}
        selected={false}
        type="tone"
        {...({} as any)}
      />,
    )

    expect(screen.getByTestId("handle-icon")).toBeInTheDocument()
    expect(screen.queryByTestId("handle-with-popover")).not.toBeInTheDocument()
  })

  // ─── Regression: BaseNode source <Handle> for non-picker nodes ──────────
  //
  // Bug: A previous commit unconditionally set `external: true` on the source
  // HandleConfig, which is correct for registered pickers (HandleWithPopover
  // renders the visible+interactive pip) but BREAKS drag-to-connect for the
  // remaining non-picker nodes that still use ParameterNodeShell (provider,
  // style-guide, duration, aspect-ratio, scene-count, motion). Those fall
  // back to <HandleIcon>, which is a `pointer-events-none` decoration only;
  // BaseNode MUST render the real (hidden) <Handle> for the connection
  // machinery to work.
  //
  // Fix: Gate `external` on `pickerMeta !== null`. These two tests pin that
  // contract by asserting on the `handles` prop BaseNode receives.
  // Uses a synthetic non-registry type because the previously-used `tone`
  // node was promoted into the registry as a non-tile-grid hint producer.
  it("REGRESSION: source handle entry has external:false for non-picker node (drag-to-connect preserved)", () => {
    mockNodes = [{ id: "node-1", type: "__unknown-fallback-type__", data: { label: "Unknown" } }]

    render(
      <ToneNode
        id="node-1"
        data={{ label: "Tone", tone: "calm" } as any}
        selected={false}
        type="tone"
        {...({} as any)}
      />,
    )

    const baseNode = screen.getByTestId("base-node")
    const handles = JSON.parse(baseNode.getAttribute("data-handles") ?? "[]") as Array<{
      id: string
      type: string
      external: boolean
    }>
    // The source handle ("tone" — see ToneNode's `handleId="tone"`).
    // `external: false` is what makes BaseNode render the real <Handle>.
    const sourceHandle = handles.find((h) => h.type === "source")
    expect(sourceHandle).toBeDefined()
    expect(sourceHandle?.external).toBe(false)
  })

  it("source handle entry has external:true for picker node (HandleWithPopover owns the pip)", () => {
    // Symmetric assertion: picker types MUST keep external:true so BaseNode
    // does NOT render a duplicate <Handle> on top of HandleWithPopover.
    mockNodes = [{ id: "node-1", type: "mood", data: { label: "Mood", mood: "calm" } }]

    render(
      <MoodNode
        id="node-1"
        data={{ label: "Mood", mood: "calm" } as any}
        selected={false}
        type="mood"
        {...({} as any)}
      />,
    )

    const baseNode = screen.getByTestId("base-node")
    const handles = JSON.parse(baseNode.getAttribute("data-handles") ?? "[]") as Array<{
      id: string
      type: string
      external: boolean
    }>
    const sourceHandle = handles.find((h) => h.type === "source")
    expect(sourceHandle).toBeDefined()
    expect(sourceHandle?.external).toBe(true)
  })

  it("renders the legacy HandleIcon decoration while the store has no matching node entry (hydration fallback)", () => {
    // Edge case: store is empty so `nodes.find(...)` returns undefined.
    // During the brief window between React-Flow scheduling this render
    // and the workflow store hydrating, we render the legacy indigo
    // HandleIcon decoration so the node doesn't have a missing-pip
    // flicker on initial mount. HandleIcon is pointer-events-none —
    // BaseNode owns the real <Handle> (external:false because pickerMeta
    // is null during hydration), so drag-to-connect is preserved AND
    // there's no duplicate-Handle warning.
    mockNodes = []

    render(
      <MoodNode
        id="node-1"
        data={{ label: "Mood", mood: "calm" } as any}
        selected={false}
        type="mood"
        {...({} as any)}
      />,
    )

    // Hydration fallback: legacy HandleIcon visible from first paint.
    expect(screen.getByTestId("handle-icon")).toBeInTheDocument()
    // HandleWithPopover stays unmounted until the store hydrates and
    // pickerMeta becomes non-null.
    expect(screen.queryByTestId("handle-with-popover")).not.toBeInTheDocument()
  })
})
