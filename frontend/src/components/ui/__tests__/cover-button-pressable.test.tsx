import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { CoverButton } from "../cover-button"
import { pressable } from "@/lib/pressable"
import { axeViolations } from "@/test/axe"

/**
 * The two ways a clickable card becomes usable from the keyboard (WCAG 2.1.1,
 * 4.1.2): `pressable` for a card with no controls inside, `CoverButton` for a
 * card with buttons of its own.
 */

afterEach(cleanup)

describe("pressable", () => {
  it("makes an element a button that Enter and Space activate, once each", () => {
    const onActivate = vi.fn()
    render(<div {...pressable(onActivate)}>Drop a file or click</div>)
    const el = screen.getByRole("button", { name: "Drop a file or click" })
    expect(el.tabIndex).toBe(0)
    fireEvent.keyDown(el, { key: "Enter" })
    fireEvent.keyDown(el, { key: " " })
    fireEvent.keyDown(el, { key: "a" })
    fireEvent.click(el)
    expect(onActivate).toHaveBeenCalledTimes(3)
  })

  it("ignores keys pressed on something inside it", () => {
    const onActivate = vi.fn()
    render(
      <div {...pressable(onActivate)}>
        <input aria-label="inner" />
      </div>,
    )
    fireEvent.keyDown(screen.getByLabelText("inner"), { key: "Enter" })
    expect(onActivate).not.toHaveBeenCalled()
  })
})

describe("CoverButton", () => {
  function Card({ onOpen, onDownload }: { onOpen: () => void; onDownload: () => void }) {
    return (
      <div className="relative" onClick={onOpen}>
        <img src="x.png" alt="" />
        <button type="button" onClick={(e) => { e.stopPropagation(); onDownload() }}>Download</button>
        <CoverButton label="Preview" onActivate={onOpen} />
      </div>
    )
  }

  it("opens the card once from the keyboard, and the card's own buttons still work", () => {
    const onOpen = vi.fn()
    const onDownload = vi.fn()
    render(<Card onOpen={onOpen} onDownload={onDownload} />)
    fireEvent.click(screen.getByRole("button", { name: "Preview" }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Download" }))
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("lets the mouse through to the card", () => {
    render(<Card onOpen={vi.fn()} onDownload={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Preview" }).className).toContain("pointer-events-none")
  })

  it("leaves no control inside another (axe clean)", async () => {
    const { container } = render(<Card onOpen={vi.fn()} onDownload={vi.fn()} />)
    expect(await axeViolations(container)).toEqual([])
  })
})
