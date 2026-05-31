import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import type { WorkflowNode } from "@/types/nodes"

// ---------------------------------------------------------------------------
// Mocks — declared before the component import.
//
// ListInputCard / LoopInputCard pull in heavy deps (@dnd-kit, useFileUpload,
// store subscriptions, media preview modals). For a *routing* test we only
// care which card got picked, so each is stubbed to an identifiable testid.
// This keeps the assertion honest: the testid that renders tells us exactly
// which branch input-card.tsx took.
// ---------------------------------------------------------------------------

vi.mock("../input-cards/list-input-card", () => ({
  ListInputCard: () => <div data-testid="list-input-card" />,
}))

vi.mock("../input-cards/loop-input-card", () => ({
  LoopInputCard: () => <div data-testid="loop-input-card" />,
}))

// The remaining card imports are inert in these tests (we only render list/loop
// nodes) but must resolve, and several drag in DOM-heavy trees — stub them out.
vi.mock("../input-cards/text-input-card", () => ({ TextInputCard: () => null }))
vi.mock("../input-cards/image-upload-card", () => ({ ImageUploadCard: () => null }))
vi.mock("../input-cards/video-upload-card", () => ({ VideoUploadCard: () => null }))
vi.mock("../input-cards/audio-upload-card", () => ({ AudioUploadCard: () => null }))
vi.mock("../input-cards/parameter-card", () => ({ ParameterCard: () => null }))
vi.mock("../input-cards/picker-input-card", () => ({ PickerInputCard: () => null }))

// useWorkflowStore is only read for cardMeta (a selector) — return undefined.
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: () => undefined,
}))

vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))

import { InputCard } from "../input-card"

// ---------------------------------------------------------------------------

function makeNode(type: string, columns: unknown[]): WorkflowNode {
  return {
    id: "n1",
    type,
    position: { x: 0, y: 0 },
    data: { label: "Test", columns },
  } as unknown as WorkflowNode
}

const baseProps = {
  isFullscreen: false,
  inputValues: {},
  onUpdateInput: vi.fn(),
}

function renderCard(node: WorkflowNode) {
  return render(<InputCard node={node} {...baseProps} />)
}

describe("InputCard list/loop routing by column count", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders the multi-column table card (LoopInputCard) for a list-typed node with 2 columns", () => {
    renderCard(makeNode("list", [{ id: "c1", name: "A" }, { id: "c2", name: "B" }]))
    expect(screen.getByTestId("loop-input-card")).toBeInTheDocument()
    expect(screen.queryByTestId("list-input-card")).not.toBeInTheDocument()
  })

  it("renders the single-column card (ListInputCard) for a list-typed node with 1 column", () => {
    renderCard(makeNode("list", [{ id: "c1", name: "A" }]))
    expect(screen.getByTestId("list-input-card")).toBeInTheDocument()
    expect(screen.queryByTestId("loop-input-card")).not.toBeInTheDocument()
  })

  it("renders the single-column card (ListInputCard) for a list-typed node with no columns", () => {
    renderCard(makeNode("list", []))
    expect(screen.getByTestId("list-input-card")).toBeInTheDocument()
    expect(screen.queryByTestId("loop-input-card")).not.toBeInTheDocument()
  })

  // A legacy `loop`-typed node never reaches InputCard anymore: the presentation
  // and app-runner load paths migrate loop→list (migrateListLoopNodes) before
  // the nodes ever hit this component, so `node.type` is always `list` here and
  // the routing is purely by column count. The migration itself is covered by
  // use-presentation-store / use-app-runner-store / list-loop-migration tests.
  // A still-`loop`-typed node falls through to the `default` branch (no
  // list/loop card), which is the correct dead-path behavior.
  it("does NOT render a list/loop card for a still-loop-typed node (falls through — loop is migrated upstream)", () => {
    renderCard(makeNode("loop", [{ id: "c1", name: "A" }, { id: "c2", name: "B" }]))
    expect(screen.queryByTestId("loop-input-card")).not.toBeInTheDocument()
    expect(screen.queryByTestId("list-input-card")).not.toBeInTheDocument()
  })
})
