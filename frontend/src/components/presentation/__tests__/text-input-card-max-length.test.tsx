/**
 * A Text node exposed whole may carry a character limit on its item (decided
 * 2026-10-06, as a field card does): it caps the app's advertised speech price,
 * so the runtime card holds the user to it — the box takes no more than the
 * limit and shows a counter. The card is reached through InputCard.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { WorkflowNode } from "@/types/nodes"

vi.setConfig({ testTimeout: 20000 })

vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: () => undefined }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))

import { InputCard } from "../input-card"
import { TextInputCard } from "../input-cards/text-input-card"

const node = { id: "s", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Script", text: "a".repeat(40) } } as unknown as WorkflowNode
const base = { isFullscreen: false, inputValues: {}, onUpdateInput: vi.fn() }

describe("Text node card — character limit", () => {
  it("InputCard hands the item's limit to the card: the box is capped and the count shows against it", () => {
    render(<InputCard node={node} {...base} maxLength={120} />)
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "120")
    expect(screen.getByTestId("field-char-count")).toHaveTextContent("40/120")
  })

  it("without a limit nothing changes: unbounded, no counter", () => {
    render(<InputCard node={node} {...base} />)
    expect(screen.getByRole("textbox")).not.toHaveAttribute("maxlength")
    expect(screen.queryByTestId("field-char-count")).toBeNull()
  })

  it.each(["prompt", "multiline", "oneline", "inline"] as const)("every input mode holds the limit: %s", (inputMode) => {
    render(<TextInputCard label="Script" value={"a".repeat(7)} onChange={() => {}} inputMode={inputMode} maxLength={50} />)
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "50")
    expect(screen.getByTestId("field-char-count")).toHaveTextContent("7/50")
  })

  it("the count turns amber at the limit", () => {
    render(<TextInputCard label="Script" value={"a".repeat(50)} onChange={() => {}} maxLength={50} />)
    expect(screen.getByTestId("field-char-count").className).toContain("text-amber-500")
  })
})
