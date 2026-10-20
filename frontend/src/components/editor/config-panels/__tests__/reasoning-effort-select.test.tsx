import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"

type StubProps = { children?: ReactNode; value?: string }

// Stub the Radix Select to plain elements: what is under test is the value the
// picker SELECTS for a node that stores no effort, not Radix's portal plumbing.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value }: StubProps) => (
    <div data-testid="select" data-value={value ?? ""}>{children}</div>
  ),
  SelectTrigger: ({ children }: StubProps) => <div>{children}</div>,
  SelectContent: ({ children }: StubProps) => <div>{children}</div>,
  SelectItem: ({ children, value }: StubProps) => <div data-testid={`item-${value}`}>{children}</div>,
  SelectValue: () => null,
}))

import { ReasoningEffortSelect } from "../reasoning-effort-select"

/** The picker's own "Auto (model default)" choice. */
const AUTO = "__auto__"

describe("ReasoningEffortSelect — the effort a node that stores none runs at", () => {
  it("describe-to-picker on Claude Opus 5.5 selects High, the recipe effort the run uses (decided 2026-10-09)", () => {
    render(<ReasoningEffortSelect feature="describe-to-picker" modelId="claude-opus-5.5" onChange={() => {}} />)
    expect(screen.getByTestId("select")).toHaveAttribute("data-value", "high")
  })

  it("describe-to-picker on its default model, unset or named, selects Auto (Gemini 3.8 Flash, decided 2026-10-20)", () => {
    for (const modelId of [undefined, "gemini-3.8-flash"]) {
      const { unmount } = render(<ReasoningEffortSelect feature="describe-to-picker" modelId={modelId} onChange={() => {}} />)
      expect(screen.getByTestId("select"), String(modelId)).toHaveAttribute("data-value", AUTO)
      unmount()
    }
  })

  it("describe-to-picker on another Claude model selects Auto: the recipe effort never follows a model switch", () => {
    render(<ReasoningEffortSelect feature="describe-to-picker" modelId="claude-opus-5" onChange={() => {}} />)
    expect(screen.getByTestId("select")).toHaveAttribute("data-value", AUTO)
  })

  it("a chosen effort is selected as chosen, so the user can lower it", () => {
    render(<ReasoningEffortSelect feature="describe-to-picker" modelId="claude-opus-5.5" value="low" onChange={() => {}} />)
    expect(screen.getByTestId("select")).toHaveAttribute("data-value", "low")
  })

  it("another feature keeps Auto for an unset effort", () => {
    render(<ReasoningEffortSelect feature="generate-script" modelId="gpt-5.6-terra" onChange={() => {}} />)
    expect(screen.getByTestId("select")).toHaveAttribute("data-value", AUTO)
  })

  it("showing the recipe writes nothing to the node", () => {
    const onChange = vi.fn()
    render(<ReasoningEffortSelect feature="describe-to-picker" modelId="claude-opus-5.5" onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })
})

// Decided 2026-10-09: on a model with a recipe effort for the feature (Opus 5.5
// on describe-to-picker), Auto is not offered. An omitted effort runs at the
// recipe, High, so Auto would be a second name for it; every level there runs
// on Anthropic's own API.
describe("ReasoningEffortSelect — no Auto on a model whose run has a recipe effort", () => {
  it("describe-to-picker on Opus 5.5 lists the levels without Auto", () => {
    render(<ReasoningEffortSelect feature="describe-to-picker" modelId="claude-opus-5.5" onChange={() => {}} />)
    expect(screen.queryByTestId(`item-${AUTO}`)).toBeNull()
    for (const level of ["low", "medium", "high", "xhigh", "max"]) expect(screen.getByTestId(`item-${level}`)).toBeInTheDocument()
  })

  it("describe-to-picker on its default model (Gemini 3.8 Flash), unset or named, offers Auto", () => {
    for (const modelId of [undefined, "gemini-3.8-flash"]) {
      const { unmount } = render(<ReasoningEffortSelect feature="describe-to-picker" modelId={modelId} onChange={() => {}} />)
      expect(screen.getByTestId(`item-${AUTO}`), String(modelId)).toBeInTheDocument()
      unmount()
    }
  })

  it("another feature on a Claude model still offers Auto", () => {
    render(<ReasoningEffortSelect feature="generate-script" modelId="claude-opus-5.5" onChange={() => {}} />)
    expect(screen.getByTestId(`item-${AUTO}`)).toBeInTheDocument()
  })

  it("the direct-lane hint on the recipe model says every run goes there, not that Auto avoids it", () => {
    const { unmount } = render(<ReasoningEffortSelect feature="describe-to-picker" modelId="claude-opus-5.5" onChange={() => {}} />)
    expect(screen.getByText(/always carries an effort/)).toBeInTheDocument()
    expect(screen.queryByText(/choosing an effort runs the call/)).toBeNull()
    unmount()
    // Another Claude model keeps the hint that choosing an effort is what sends it there.
    render(<ReasoningEffortSelect feature="describe-to-picker" modelId="claude-opus-5" onChange={() => {}} />)
    expect(screen.getByText(/choosing an effort runs the call/)).toBeInTheDocument()
  })
})
