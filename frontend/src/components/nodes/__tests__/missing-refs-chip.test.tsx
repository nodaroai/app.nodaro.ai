import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const openPopup = vi.fn()
let missingValue: Array<{ kind: "text"; name: string }> = []
let readOnly = false

vi.mock("@/hooks/use-missing-prompt-refs", () => ({
  useMissingPromptRefs: () => missingValue,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({ isReadOnly: readOnly, openAddNodePopupForHandle: openPopup }),
}))
vi.mock("@xyflow/react", () => ({ useStore: () => 1 }))
// Render Radix popover children inline so the menu is deterministic in jsdom.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { MissingRefsChip } from "../missing-refs-chip"

function renderChip() {
  return render(<MissingRefsChip nodeId="img" nodeType="generate-image" handleId="prompt" />)
}

describe("MissingRefsChip", () => {
  beforeEach(() => {
    openPopup.mockClear()
    missingValue = []
    readOnly = false
  })

  it("renders nothing when there are no missing refs", () => {
    const { container } = renderChip()
    expect(container.firstChild).toBeNull()
  })

  it("renders the count when refs are missing", () => {
    missingValue = [{ kind: "text", name: "Hero" }, { kind: "text", name: "Bg" }]
    renderChip()
    expect(screen.getByText("2")).toBeInTheDocument()
  })

  it("renders nothing in read-only mode", () => {
    missingValue = [{ kind: "text", name: "Hero" }]
    readOnly = true
    const { container } = renderChip()
    expect(container.firstChild).toBeNull()
  })

  it("opens the add-node popup pre-named when a ref is picked", () => {
    missingValue = [{ kind: "text", name: "Hero" }]
    renderChip()
    fireEvent.click(screen.getByTestId("missing-ref-Hero"))
    expect(openPopup).toHaveBeenCalledWith({
      nodeId: "img",
      handleId: "prompt",
      direction: "target",
      nodeType: "generate-image",
      prefillName: "Hero",
    })
  })
})
