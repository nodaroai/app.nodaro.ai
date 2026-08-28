/**
 * Tests for the shared "Prompt hint" (Full / Compact) lever that
 * `ParameterNodeShell` renders for every registered parameter picker.
 *
 * Three contracts are pinned here:
 *
 *  1. The control is rendered for a registry picker (`mood`) and NOT for a
 *     node type outside the picker registry — free-text / pure-runtime
 *     parameter nodes have no catalog `term` to switch to, so a toggle there
 *     would be dead UI.
 *  2. Clicking "Compact" writes `{ hintMode: "compact" }` into the node's
 *     `data` via `updateNodeData` (that is what persists it through save,
 *     copy/paste and preset capture) and flips `aria-selected`.
 *  3. The prompt preview re-renders off the new `data` — the shell composes
 *     it with `getParameterPromptHint(node)`, the SAME function the frontend
 *     DAG executor and the backend orchestrator call, so what the preview
 *     shows is literally what gets injected downstream.
 *
 * `getParameterPromptHint` is mocked with a hint-mode-aware stub on purpose:
 * the per-catalog compact `term` composition lives in `@nodaro/prompts` and
 * is covered by that package's own tests. What is under test here is the
 * shell's wiring — that the mode reaches `data`, and that a `data` change
 * re-drives the preview.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mutable mock state — re-seeded per test.
// ---------------------------------------------------------------------------

let mockNodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = []
const updateNodeData = vi.fn()
const updateNode = vi.fn()

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

// Hint-mode-aware stub: the exact lever the shell is expected to pass through
// `node.data`. Everything else in @nodaro/prompts stays real (the picker
// components imported by mood-node need it).
vi.mock("@nodaro/prompts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getParameterPromptHint: (node: any) =>
    node?.data?.hintMode === "compact"
      ? "COMPACT-TERM"
      : "FULL-LONG-FORM-PROMPT-HINT",
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => <div data-testid="editable-node-label">{label}</div>,
}))

vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: ({ color, nodeType }: any) => (
    <div data-testid="handle-with-popover" data-color={color} data-node-type={nodeType} />
  ),
}))

vi.mock("../handle-icon", () => ({
  HandleIcon: ({ color }: any) => <div data-testid="handle-icon" data-color={color} />,
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => <div data-testid="run-node-button" />,
}))

vi.mock("lucide-react", () => {
  const I = (p: Record<string, unknown>) => <span data-testid="mock-icon" {...p} />
  return new Proxy({} as Record<PropertyKey, unknown>, {
    get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? I : undefined),
    has: () => true,
  })
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
        updateNodeData,
        updateNode,
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
import { ToneNode } from "../tone-node"

const FULL_TAB = "Prompt hint: Full"
const COMPACT_TAB = "Prompt hint: Compact"

beforeEach(() => {
  updateNodeData.mockClear()
  updateNode.mockClear()
})

describe("ParameterNodeShell — shared Prompt hint (Full / Compact) lever", () => {
  it("renders the lever for a registry picker, defaulting to Full when hintMode is absent", () => {
    // `displayMode: "prompt"` so the composed-hint preview is mounted.
    mockNodes = [
      { id: "node-1", type: "mood", data: { label: "Mood", mood: "calm", displayMode: "prompt" } },
    ]

    render(
      <MoodNode
        id="node-1"
        data={{ label: "Mood", mood: "calm" } as any}
        selected
        type="mood"
        {...({} as any)}
      />,
    )

    // Absent hintMode === "full": the default is preserved, not written.
    expect(screen.getByLabelText(FULL_TAB)).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText(COMPACT_TAB)).toHaveAttribute("aria-selected", "false")
    expect(screen.getByText("FULL-LONG-FORM-PROMPT-HINT")).toBeInTheDocument()
  })

  it("writes hintMode:'compact' into node data when Compact is clicked", () => {
    mockNodes = [
      { id: "node-1", type: "mood", data: { label: "Mood", mood: "calm", displayMode: "prompt" } },
    ]

    render(
      <MoodNode
        id="node-1"
        data={{ label: "Mood", mood: "calm" } as any}
        selected
        type="mood"
        {...({} as any)}
      />,
    )

    fireEvent.click(screen.getByLabelText(COMPACT_TAB))

    // The load-bearing assertion: the mode lands in `node.data`, which is
    // what persists through save / copy+paste / preset capture.
    expect(updateNodeData).toHaveBeenCalledWith("node-1", { hintMode: "compact" })
  })

  it("the composed-hint preview reflects the mode once data carries it", () => {
    mockNodes = [
      { id: "node-1", type: "mood", data: { label: "Mood", mood: "calm", displayMode: "prompt" } },
    ]

    const { rerender } = render(
      <MoodNode
        id="node-1"
        data={{ label: "Mood", mood: "calm" } as any}
        selected
        type="mood"
        {...({} as any)}
      />,
    )
    expect(screen.getByText("FULL-LONG-FORM-PROMPT-HINT")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(COMPACT_TAB))

    // Apply the write the (mocked) store would have made, then re-render:
    // the shell reads its node from the store, so this is exactly the update
    // path a real click takes.
    mockNodes = [
      {
        id: "node-1",
        type: "mood",
        data: { label: "Mood", mood: "calm", displayMode: "prompt", hintMode: "compact" },
      },
    ]
    rerender(
      <MoodNode
        id="node-1"
        data={{ label: "Mood", mood: "calm" } as any}
        selected
        type="mood"
        {...({} as any)}
      />,
    )

    expect(screen.getByText("COMPACT-TERM")).toBeInTheDocument()
    expect(screen.queryByText("FULL-LONG-FORM-PROMPT-HINT")).not.toBeInTheDocument()
    expect(screen.getByLabelText(COMPACT_TAB)).toHaveAttribute("aria-selected", "true")
  })

  it("does NOT render the lever for a node type outside the picker registry", () => {
    // Free-text / pure-runtime parameter nodes carry no catalog term, so the
    // shell must not offer a mode that cannot change anything.
    mockNodes = [
      {
        id: "node-1",
        type: "__unknown-fallback-type__",
        data: { label: "Unknown", displayMode: "prompt" },
      },
    ]

    render(
      <ToneNode
        id="node-1"
        data={{ label: "Tone", tone: "calm" } as any}
        selected
        type="tone"
        {...({} as any)}
      />,
    )

    expect(screen.queryByLabelText(FULL_TAB)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(COMPACT_TAB)).not.toBeInTheDocument()
  })
})
