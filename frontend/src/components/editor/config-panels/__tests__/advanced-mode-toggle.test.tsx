/**
 * Advanced mode is shown DISABLED with a reason on models that can't run it,
 * rather than hidden — a control that vanishes reads as a bug, a greyed one
 * with a reason tells the user what to change.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AdvancedModeToggle } from "../advanced-mode-toggle"

function setup(props: Partial<Parameters<typeof AdvancedModeToggle>[0]> = {}) {
  const onChange = vi.fn()
  render(<AdvancedModeToggle feature="llm-chat" onChange={onChange} {...props} />)
  return { onChange, toggle: screen.getByRole("switch") }
}

describe("model support gating", () => {
  it("is enabled for a Gemini model (has a direct lane)", () => {
    const { toggle } = setup({ modelId: "gemini-3.6-flash" })
    expect(toggle).not.toBeDisabled()
  })

  it("is DISABLED, not hidden, for a model with no direct lane", () => {
    const { toggle } = setup({ modelId: "claude-opus-4.7" })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/available on Gemini models/i)).toBeInTheDocument()
  })

  it("stays disabled for GPT too", () => {
    expect(setup({ modelId: "gpt-5.2" }).toggle).toBeDisabled()
  })
})

describe("value semantics", () => {
  it("writes undefined rather than false when switched off", async () => {
    const { onChange, toggle } = setup({ modelId: "gemini-3.6-flash", value: true })
    await userEvent.click(toggle)
    // `false` would dirty a workflow that never used the feature; undefined
    // keeps stored node data byte-identical to pre-feature workflows.
    expect(onChange).toHaveBeenCalledWith({ advancedMode: undefined })
  })

  it("writes true when switched on", async () => {
    const { onChange, toggle } = setup({ modelId: "gemini-3.6-flash" })
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith({ advancedMode: true })
  })

  it("clears a stale flag when the model switches to one that can't run advanced", () => {
    const onChange = vi.fn()
    render(<AdvancedModeToggle feature="llm-chat" modelId="gpt-5.2" value={true} onChange={onChange} />)
    // Otherwise the node keeps an unreachable flag and the route 400s on the
    // next run with no visible cause.
    expect(onChange).toHaveBeenCalledWith({ advancedMode: undefined })
  })
})

describe("sampling levers", () => {
  it("are hidden until advanced is on", () => {
    setup({ modelId: "gemini-3.6-flash" })
    // Matched on the label's exact shape, not the word — the off-state hint
    // mentions "temperature" in prose and would false-positive a loose regex.
    expect(screen.queryByText(/^Temperature: /)).not.toBeInTheDocument()
    expect(screen.queryByText("Max Tokens")).not.toBeInTheDocument()
  })

  it("appear once advanced is on", () => {
    setup({ modelId: "gemini-3.6-flash", value: true })
    expect(screen.getByText(/^Temperature: /)).toBeInTheDocument()
    expect(screen.getByText("Max Tokens")).toBeInTheDocument()
  })

  it("seeds from the FEATURE's real route defaults, not a hardcoded 0.7/2048", () => {
    // after-effects sends 0.3/2048; the panel used to show 0.7/2048 on it.
    render(<AdvancedModeToggle feature="after-effects" modelId="gemini-3.6-flash" value onChange={vi.fn()} />)
    expect(screen.getByText("Temperature: 0.3")).toBeInTheDocument()
    expect(screen.getByDisplayValue("2048")).toBeInTheDocument()
  })

  it("seeds 3d-title at its real 3072 budget", () => {
    // One arrow-key press used to commit 2048 here, cutting the budget by a
    // third on a node that emits structured JSON.
    render(<AdvancedModeToggle feature="3d-title" modelId="gemini-3.6-flash" value onChange={vi.fn()} />)
    expect(screen.getByText("Temperature: 0.4")).toBeInTheDocument()
    expect(screen.getByDisplayValue("3072")).toBeInTheDocument()
  })

  it("warns about format breakage on structured-output features", () => {
    render(<AdvancedModeToggle feature="after-effects" modelId="gemini-3.6-flash" value onChange={vi.fn()} />)
    expect(screen.getByText(/breaking format/i)).toBeInTheDocument()
  })

  it("stays quiet about format on free-text features", () => {
    render(<AdvancedModeToggle feature="llm-chat" modelId="gemini-3.6-flash" value onChange={vi.fn()} />)
    expect(screen.queryByText(/breaking format/i)).not.toBeInTheDocument()
  })
})

describe("cost disclosure", () => {
  it("says the tier bump out loud before the user opts in", () => {
    setup({ modelId: "gemini-3.6-flash" })
    // A silent price increase reads as a billing bug.
    expect(screen.getByText(/one credit tier more, capped at premium/i)).toBeInTheDocument()
  })
})
