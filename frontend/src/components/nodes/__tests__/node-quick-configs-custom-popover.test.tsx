import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: any) => sel({ updateNodeData }),
}))

// Stub the Radix Select with the ONE behaviour under test: picking an item
// reports the value, closes, and (like Radix's onCloseAutoFocus) returns focus
// to the trigger. The Popover is REAL — its focus-outside dismissal is the
// mechanism this file pins.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react")
  const Ctx = React.createContext<(v: string) => void>(() => {})
  return {
    Select: ({ children, onValueChange }: any) => (
      <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children, ...p }: any) => (
      <button type="button" data-testid="select-trigger" aria-label={p["aria-label"]}>
        {children}
      </button>
    ),
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => {
      const onChange = React.useContext(Ctx)
      return (
        <button type="button" data-testid={`item-${value}`} onClick={() => onChange(value)}>
          {children}
        </button>
      )
    },
    SelectValue: ({ children }: any) => <span>{children}</span>,
  }
})

import { QuickConfigSelect, type NodeQuickConfigControl, type QuickConfigControl } from "../node-quick-configs"

const durationControl: NodeQuickConfigControl = {
  nodeType: "test-node",
  field: "duration",
  ariaLabel: "Duration",
  numeric: true,
  options: [8, 15, 30].map((v) => ({ value: String(v), label: `${v}s` })),
  customRange: { min: 4, max: 120, unit: "s" },
}

beforeEach(() => updateNodeData.mockClear())

async function openCustom(onOpenChange?: (open: boolean) => void) {
  render(
    <>
      <QuickConfigSelect nodeId="n1" control={durationControl} value="8" data={{}} onOpenChange={onOpenChange} />
      <div data-testid="elsewhere" style={{ width: 200, height: 200 }} />
    </>,
  )
  await userEvent.click(screen.getByTestId("item-__custom__"))
  expect(await screen.findByLabelText("Duration (custom value)")).toBeInTheDocument()
  // Radix attaches its outside listeners in a setTimeout(0).
  await act(() => new Promise((r) => setTimeout(r, 20)))
}

describe("QuickConfigSelect Custom… popover", () => {
  // The bug (2026-09-16): the Select trigger is the popover's ANCHOR, not its
  // PopoverTrigger, so when the closing Select returned focus to it Radix read
  // a focus-outside and dismissed the editor one frame after it opened.
  it("survives focus returning to the Select trigger after the item closes", async () => {
    await openCustom()
    const trigger = screen.getByTestId("select-trigger")
    await act(async () => {
      trigger.focus()
      fireEvent.focusIn(trigger)
    })
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(screen.queryByLabelText("Duration (custom value)")).toBeInTheDocument()
  })

  it("still dismisses on a pointer interaction elsewhere", async () => {
    await openCustom()
    const outside = screen.getByTestId("elsewhere")
    fireEvent.pointerDown(outside, { button: 0, pointerType: "mouse" })
    fireEvent.mouseDown(outside, { button: 0 })
    fireEvent.mouseUp(outside, { button: 0 })
    fireEvent.click(outside, { button: 0 })
    await waitFor(() => expect(screen.queryByLabelText("Duration (custom value)")).toBeNull())
  })

  // The host strip pins the hover toolbar only while a counted dropdown is
  // open. An uncounted editor let the strip unmount (and take the editor with
  // it) the moment the Select's close landed — so the popover must report its
  // open (+1, before the Select's deferred −1) and its close (−1) upward.
  it("reports its open/close to the host strip's counter", async () => {
    const onOpenChange = vi.fn()
    await openCustom(onOpenChange)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    onOpenChange.mockClear()
    const outside = screen.getByTestId("elsewhere")
    fireEvent.pointerDown(outside, { button: 0, pointerType: "mouse" })
    fireEvent.mouseDown(outside, { button: 0 })
    fireEvent.mouseUp(outside, { button: 0 })
    fireEvent.click(outside, { button: 0 })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onOpenChange).not.toHaveBeenCalledWith(true)
  })
})
