import { describe, it, expect, vi, afterEach } from "vitest"
import { useRef } from "react"
import { render, screen, cleanup } from "@testing-library/react"
import { useBodyMenuDismiss } from "../use-body-menu-dismiss"

/**
 * Locks the shared body-menu lifecycle the four chip-swap pill views rely on:
 * dismiss on outside-click / Escape while open, plus react-remove-scroll escape
 * (wheel/touch don't reach `document`) so the menu scrolls inside a Radix Dialog
 * modal. See use-body-menu-dismiss.ts + scroll-lock-escape.ts.
 */
function Harness({ anchor, onDismiss }: { anchor: DOMRect | null; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useBodyMenuDismiss(ref, anchor, onDismiss)
  return (
    <div ref={ref} data-testid="menu" style={{ overflowY: "auto" }}>
      <button data-testid="inside">x</button>
      <input data-testid="input-inside" />
    </div>
  )
}

describe("useBodyMenuDismiss", () => {
  afterEach(cleanup)

  it("dismisses on outside pointerdown when open", () => {
    const onDismiss = vi.fn()
    render(<Harness anchor={new DOMRect()} onDismiss={onDismiss} />)
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("does NOT dismiss on pointerdown inside the menu", () => {
    const onDismiss = vi.fn()
    render(<Harness anchor={new DOMRect()} onDismiss={onDismiss} />)
    screen.getByTestId("inside").dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("dismisses on Escape when open", () => {
    const onDismiss = vi.fn()
    render(<Harness anchor={new DOMRect()} onDismiss={onDismiss} />)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("dismisses on Escape via a CAPTURE-phase listener even when a bubble handler would stop it", () => {
    const onDismiss = vi.fn()
    render(<Harness anchor={new DOMRect()} onDismiss={onDismiss} />)
    // A bubble-phase listener that swallows Escape (mimics ProseMirror/Radix).
    const swallow = (e: Event) => e.stopPropagation()
    document.addEventListener("keydown", swallow)
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(onDismiss).toHaveBeenCalledTimes(1) // capture ran first, unaffected
    document.removeEventListener("keydown", swallow)
  })

  it("does NOT dismiss on Escape from a text input inside the menu (keeps the input's own Escape)", () => {
    const onDismiss = vi.fn()
    render(<Harness anchor={new DOMRect()} onDismiss={onDismiss} />)
    screen.getByTestId("input-inside").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("does nothing when closed (anchor null) — no listeners attached", () => {
    const onDismiss = vi.fn()
    render(<Harness anchor={null} onDismiss={onDismiss} />)
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("isolates wheel from document so the menu can scroll inside a modal", () => {
    render(<Harness anchor={new DOMRect()} onDismiss={() => {}} />)
    const docSpy = vi.fn()
    document.addEventListener("wheel", docSpy)
    screen.getByTestId("inside").dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }))
    expect(docSpy).not.toHaveBeenCalled()
    document.removeEventListener("wheel", docSpy)
  })
})
