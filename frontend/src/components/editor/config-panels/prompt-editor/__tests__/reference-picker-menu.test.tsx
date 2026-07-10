import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { ReferencePickerMenu } from "../reference-picker-menu"
import type { RefImageItem } from "../../tag-textarea"

afterEach(cleanup)

const anchor = (): DOMRect =>
  ({ top: 100, left: 100, right: 150, bottom: 150, width: 50, height: 50, x: 100, y: 100, toJSON() {} }) as DOMRect

const img = (over: Partial<RefImageItem>): RefImageItem =>
  ({ url: "https://cdn/i.png", label: "Image 1", source: "wired", index: 1, defaultLabel: "", ...over }) as RefImageItem

describe("ReferencePickerMenu", () => {
  it("renders a row per attached reference with its label", () => {
    const items = [img({ label: "Image 1", index: 1 }), img({ source: "character", label: "Kira", characterSlug: "kira", index: 2 })]
    render(<ReferencePickerMenu items={items} anchor={anchor()} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("Image 1")).toBeInTheDocument()
    expect(screen.getByText("Kira")).toBeInTheDocument()
  })

  it("fires onSelect with the chosen item on click", () => {
    const onSelect = vi.fn()
    const it0 = img({ label: "Image 1" })
    render(<ReferencePickerMenu items={[it0]} anchor={anchor()} onSelect={onSelect} onClose={() => {}} />)
    fireEvent.click(screen.getByText("Image 1").closest("button")!)
    expect(onSelect).toHaveBeenCalledWith(it0)
  })

  it("shows the FIRST item's preview immediately on open (issue 3)", () => {
    render(<ReferencePickerMenu items={[img({ label: "Image 1" })]} anchor={anchor()} onSelect={() => {}} onClose={() => {}} />)
    // Row thumbnail (1) + the side preview for the pre-selected first row (1) —
    // no hover required.
    expect(document.querySelectorAll("img").length).toBe(2)
  })

  it("closes on Escape even when focus is NOT in the menu (capture-phase, issue 1)", () => {
    const onClose = vi.fn()
    render(<ReferencePickerMenu items={[img({})]} anchor={anchor()} onSelect={() => {}} onClose={onClose} />)
    // Fire on document.body — the real-app case where the editor/dialog holds
    // focus. A capture-phase document listener catches it before ProseMirror/Radix.
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("arrow keys move the active row and Enter selects it (capture-phase)", () => {
    const onSelect = vi.fn()
    const items = [img({ label: "Image 1", index: 1 }), img({ label: "Image 2", index: 2 })]
    render(<ReferencePickerMenu items={items} anchor={anchor()} onSelect={onSelect} onClose={() => {}} />)
    fireEvent.keyDown(document.body, { key: "ArrowDown" })
    fireEvent.keyDown(document.body, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledWith(items[1])
  })

  it("clamps a long menu fully within the viewport (issue 2)", () => {
    const origH = window.innerHeight
    Object.defineProperty(window, "innerHeight", { value: 300, configurable: true })
    const many = Array.from({ length: 40 }, (_, i) => img({ label: `Image ${i}`, index: i + 1 }))
    // Anchor near the bottom of a short viewport.
    const lowAnchor = { top: 260, left: 100, right: 150, bottom: 290, width: 50, height: 30, x: 100, y: 260, toJSON() {} } as DOMRect
    render(<ReferencePickerMenu items={many} anchor={lowAnchor} onSelect={() => {}} onClose={() => {}} />)
    const menu = screen.getByTestId("reference-picker-menu")
    const top = parseFloat(menu.style.top)
    const mh = parseFloat(menu.style.maxHeight)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top + mh).toBeLessThanOrEqual(300) // fully on-screen, scrolls inside
    Object.defineProperty(window, "innerHeight", { value: origH, configurable: true })
  })

  it("renders a placeholder when there are no references", () => {
    render(<ReferencePickerMenu items={[]} anchor={anchor()} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/no references/i)).toBeInTheDocument()
  })

  it("displays a character's board rows before its variant rows (display-only sort)", () => {
    const items = [
      img({ label: "Upload 1", source: "uploaded", index: 1 }),
      img({ label: "Kira", source: "character", index: 2, characterSlug: "kira" }),
      img({ label: "Kira / smile", source: "character", index: 2, characterSlug: "kira", variantSlug: "smile", bucket: "expressions" }),
      img({ label: "Kira / Base", source: "character", index: 2, characterSlug: "kira", variantSlug: "base", bucket: "boards" }),
    ]
    render(<ReferencePickerMenu items={items} anchor={anchor()} onSelect={() => {}} onClose={() => {}} />)
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent)
    const boardPos = labels.findIndex((t) => t?.includes("Base"))
    const smilePos = labels.findIndex((t) => t?.includes("smile"))
    expect(boardPos).toBeGreaterThan(-1)
    expect(boardPos).toBeLessThan(smilePos)
  })

  it("shows a 'board' badge on board rows only", () => {
    const items = [
      img({ label: "Kira / smile", source: "character", index: 1, characterSlug: "kira", variantSlug: "smile", bucket: "expressions" }),
      img({ label: "Kira / Base", source: "character", index: 1, characterSlug: "kira", variantSlug: "base", bucket: "boards" }),
    ]
    render(<ReferencePickerMenu items={items} anchor={anchor()} onSelect={() => {}} onClose={() => {}} />)
    const rows = screen.getAllByRole("menuitem")
    const boardRow = rows.find((r) => r.textContent?.includes("Base"))!
    const smileRow = rows.find((r) => r.textContent?.includes("smile"))!
    expect(boardRow.textContent).toMatch(/board/i)
    expect(smileRow.textContent).not.toMatch(/board/i)
  })
})
