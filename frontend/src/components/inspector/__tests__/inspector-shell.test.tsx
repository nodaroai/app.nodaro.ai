import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { InspectorShell } from "../inspector-shell"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { isModalDialogOpen } from "@/lib/modal-open"

// The one modal every node result inspector opens in. What it must guarantee is
// isolation from the canvas it is opened over — without starving the listeners
// that must keep working under it (see the file header).

const copy = vi.hoisted(() => vi.fn())
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  copyToClipboard: copy,
}))

beforeEach(() => copy.mockReset())

function open(props: Partial<React.ComponentProps<typeof InspectorShell>> = {}) {
  const onClose = vi.fn()
  const parent = { onClick: vi.fn(), onDoubleClick: vi.fn(), onContextMenu: vi.fn() }
  render(
    // Stands for the canvas node the inspector is rendered from: React events
    // from a portal bubble through the React tree into it.
    <div {...parent}>
      <InspectorShell open onClose={onClose} title="Tighten Plan" meta="3 clips" {...props}>
        <p>body</p>
        {props.children}
      </InspectorShell>
    </div>,
  )
  return { onClose, parent }
}

describe("InspectorShell", () => {
  it("shows the title, meta and body when open", () => {
    open()
    expect(screen.getByRole("dialog", { name: "Tighten Plan" })).toBeTruthy()
    expect(screen.getByText("3 clips")).toBeTruthy()
    expect(screen.getByText("body")).toBeTruthy()
  })

  it("renders nothing while closed", () => {
    render(<InspectorShell open={false} onClose={() => {}} title="x"><p>body</p></InspectorShell>)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("is a modal the editor stands down for, inside React Flow's .nokey", () => {
    expect(isModalDialogOpen()).toBe(false)
    open()
    // The canvas shortcut gate, its Escape branch and its delete guard all ask this.
    expect(isModalDialogOpen()).toBe(true)
    // @xyflow/system skips key events whose target is inside `.nokey`.
    expect(screen.getByRole("dialog").classList.contains("nokey")).toBe(true)
  })

  it("keeps clicks, double-clicks and context menus from reaching the node it was opened from", () => {
    const { parent } = open()
    const body = screen.getByText("body")
    fireEvent.click(body)
    fireEvent.doubleClick(body)
    fireEvent.contextMenu(body)
    expect(parent.onClick).not.toHaveBeenCalled()
    expect(parent.onDoubleClick).not.toHaveBeenCalled()
    expect(parent.onContextMenu).not.toHaveBeenCalled()
  })

  // Review of #1789: a contained keydown starved the window listener that saves
  // the workflow — Cmd/Ctrl+S opened the browser's Save Page dialog instead.
  describe("keys reach the listeners that keep working under a modal", () => {
    let saves = 0
    const onWindowKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        saves++
      }
    }
    beforeEach(() => { saves = 0; window.addEventListener("keydown", onWindowKey) })
    afterEach(() => window.removeEventListener("keydown", onWindowKey))

    it("Cmd/Ctrl+S inside the inspector still saves", () => {
      open()
      const dialog = screen.getByRole("dialog")
      expect(fireEvent.keyDown(dialog, { key: "s", metaKey: true })).toBe(false) // default prevented
      expect(fireEvent.keyDown(dialog, { key: "s", ctrlKey: true })).toBe(false)
      expect(saves).toBe(2)
    })
  })

  // Review of #1789: the stopped clicks hid every inside click from a Radix
  // popover open above the content — it never closed.
  it("a popover opened inside closes on a click elsewhere in the inspector, and the inspector stays", async () => {
    const { onClose } = open({
      children: (
        <Popover>
          <PopoverTrigger>details</PopoverTrigger>
          <PopoverContent>popover body</PopoverContent>
        </Popover>
      ),
    })
    await userEvent.click(screen.getByText("details"))
    expect(await screen.findByText("popover body")).toBeInTheDocument()
    // Radix attaches its outside listeners in a setTimeout(0).
    await act(() => new Promise((r) => setTimeout(r, 20)))
    const body = screen.getByText("body")
    fireEvent.pointerDown(body, { button: 0, pointerType: "mouse" })
    fireEvent.mouseDown(body, { button: 0 })
    fireEvent.mouseUp(body, { button: 0 })
    fireEvent.click(body, { button: 0 })
    await waitFor(() => expect(screen.queryByText("popover body")).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
  })

  // Review of #1789: a right-click on the backdrop keeps the modal open but blurred
  // it to <body>, where React Flow's Backspace deletes the selected nodes.
  it("pressing the backdrop keeps focus in the dialog", () => {
    open()
    const overlay = document.querySelector('[data-slot="inspector-overlay"]')!
    expect(fireEvent.mouseDown(overlay, { button: 2 })).toBe(false) // default prevented: no blur
  })

  it("closes from its close button and from Escape", () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // Review of #1789: with no Dialog.Trigger, Radix dropped focus on <body>.
  it("returns focus to whatever opened it", async () => {
    function Opener() {
      const [isOpen, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>expand</button>
          <InspectorShell open={isOpen} onClose={() => setOpen(false)} title="Plan"><p>body</p></InspectorShell>
        </>
      )
    }
    render(<Opener />)
    const expand = screen.getByRole("button", { name: "expand" })
    expand.focus()
    await userEvent.click(expand)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")))
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.activeElement).toBe(expand)
  })

  it("offers Copy JSON only when given a value", () => {
    open()
    expect(screen.queryByRole("button", { name: "Copy JSON" })).toBeNull()
  })

  it("copies the given value, pretty-printed", () => {
    open({ copyValue: { a: 1 } })
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }))
    expect(copy).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2), "Data copied")
  })

  it("pins a footer below the scrolling body", () => {
    open({ footer: <button type="button">Render final</button> })
    expect(screen.getByRole("button", { name: "Render final" })).toBeTruthy()
  })
})
