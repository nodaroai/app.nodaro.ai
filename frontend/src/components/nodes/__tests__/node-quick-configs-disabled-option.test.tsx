/**
 * A quick-strip option can be GREYED with a reason instead of removed (Speaker
 * View's Crossfade when no speaker change crosses a clock jump, decided
 * 2026-10-08). It must stay reachable by keyboard (so its reason is readable on
 * focus, like the panel's tiles), show the reason on hover and as visible text,
 * and never write a value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: any) => sel({ updateNodeData, nodes: [], edges: [] }),
}))

// Radix Select stubbed down to what the strip hands each item: the props it
// passes (disabled / aria-disabled / title) and the children it draws.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react")
  const Ctx = React.createContext<(v: string) => void>(() => {})
  return {
    Select: ({ children, onValueChange }: any) => <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>,
    SelectTrigger: ({ children, ...p }: any) => <button type="button" aria-label={p["aria-label"]}>{children}</button>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value, disabled, title, ...p }: any) => {
      const onChange = React.useContext(Ctx)
      return (
        <button type="button" role="option" data-testid={`item-${value}`} data-hard-disabled={disabled ? "true" : undefined} aria-disabled={p["aria-disabled"]} title={title} onClick={() => onChange(value)}>
          {children}
        </button>
      )
    },
    SelectValue: ({ children }: any) => <span>{children}</span>,
  }
})

import { QuickConfigSelect, type QuickConfigControl } from "../node-quick-configs"

const REASON = "Nothing was cut out between the speakers."
const control: QuickConfigControl = {
  field: "switchType",
  ariaLabel: "Switch",
  options: [
    { value: "cut", label: "Cut" },
    { value: "__crossfade__", label: "Crossfade", disabled: true, reason: REASON },
  ],
}

beforeEach(() => updateNodeData.mockClear())
afterEach(() => cleanup())

describe("QuickConfigSelect: a greyed option", () => {
  it("is aria-disabled, not removed from the tab order, and carries its reason on hover", () => {
    render(<QuickConfigSelect nodeId="n1" control={control} value="cut" data={{}} />)
    const item = screen.getByTestId("item-__crossfade__")
    expect(item).toHaveAttribute("aria-disabled", "true")
    expect(item.dataset.hardDisabled).toBeUndefined()
    expect(item).toHaveAttribute("title", REASON)
  })

  it("shows the reason as visible text under the label", () => {
    render(<QuickConfigSelect nodeId="n1" control={control} value="cut" data={{}} />)
    expect(screen.getByTestId("item-__crossfade__").textContent).toContain(REASON)
    expect(screen.getByTestId("item-cut").textContent).not.toContain(REASON)
  })

  it("never writes when chosen", () => {
    render(<QuickConfigSelect nodeId="n1" control={control} value="cut" data={{}} />)
    fireEvent.click(screen.getByTestId("item-__crossfade__"))
    expect(updateNodeData).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId("item-cut"))
    expect(updateNodeData).toHaveBeenCalledWith("n1", { switchType: "cut" })
  })

  it("does not snap a stored value that is only greyed", () => {
    const stored: QuickConfigControl = { ...control, options: [{ value: "cut", label: "Cut" }, { value: "xfade:wipe-left", label: "Wipe Left", disabled: true, reason: REASON }] }
    render(<QuickConfigSelect nodeId="n1" control={stored} value="xfade:wipe-left" data={{}} />)
    expect(updateNodeData).not.toHaveBeenCalled()
  })
})
