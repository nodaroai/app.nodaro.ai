import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} }, createClient: () => ({ auth: {} }) }))

import { ComposerBar } from "../composer-bar"
import type { WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id } }) as WorkflowNode

const renderInputCard = (n: WorkflowNode) => <div data-testid={`card-${n.id}`}>{n.id}</div>

function setup(over: Partial<React.ComponentProps<typeof ComposerBar>> = {}) {
  return render(
    <MemoryRouter>
      <ComposerBar
        inputNodes={[node("a", "text-prompt"), node("b", "upload-image")]}
        inputValues={{ a: { text: "hi" }, b: { url: "u" } }}
        renderInputCard={renderInputCard}
        isRunning={false}
        costLabel=" (12 CR)"
        allInputsFilled={true}
        needsMoreCredits={false}
        onLaunch={() => {}}
        {...over}
      />
    </MemoryRouter>,
  )
}

describe("ComposerBar", () => {
  it("shows the credit cost on Launch and is enabled when inputs are filled", () => {
    setup()
    expect(screen.getByRole("button", { name: /Launch \(12 CR\)/ })).toBeEnabled()
  })

  it("disables Launch when inputs are incomplete", () => {
    setup({ inputNodes: [node("a", "text-prompt")], inputValues: { a: { text: "" } }, allInputsFilled: false, costLabel: "" })
    expect(screen.getByRole("button", { name: /Launch/ })).toBeDisabled()
  })

  it("shows Running… and disables Launch while a run is in flight", () => {
    setup({ isRunning: true })
    const btn = screen.getByRole("button", { name: /Running/ })
    expect(btn).toBeDisabled()
  })

  it("surfaces an insufficient-credits hint", () => {
    setup({ needsMoreCredits: true })
    expect(screen.getByText(/Insufficient credits/)).toBeInTheDocument()
  })
})
