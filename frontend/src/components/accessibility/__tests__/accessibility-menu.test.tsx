import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AccessibilityMenu, buttonHiddenOn, isMenuShortcut } from "../accessibility-menu"
import { STORAGE_KEY } from "@/lib/accessibility-preferences"
import { axeViolations } from "@/test/axe"

function renderMenu(pathname = "/projects") {
  const onNavigate = vi.fn()
  const view = render(<AccessibilityMenu pathname={pathname} showStatementLink onNavigate={onNavigate} />)
  return { ...view, onNavigate }
}

function press(code: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { code, altKey: true, ...init })
}

describe("accessibility menu", () => {
  beforeEach(() => {
    window.localStorage.clear()
    for (const name of [...document.documentElement.getAttributeNames()]) {
      if (name.startsWith("data-a11y-")) document.documentElement.removeAttribute(name)
    }
  })

  it("opens from a named button and every choice is a named toggle", async () => {
    renderMenu()
    fireEvent.click(screen.getByRole("button", { name: "Accessibility menu" }))
    const dialog = await screen.findByRole("dialog", { name: "Accessibility" })
    for (const name of ["Higher contrast", "Highlight links", "Highlight headings", "Readable font", "Text spacing", "Large cursor", "Reduce motion"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false")
    }
    expect(await axeViolations(dialog)).toEqual([])
  })

  it("applies a choice to the page and keeps it for the next visit", async () => {
    renderMenu()
    fireEvent.click(screen.getByRole("button", { name: "Accessibility menu" }))
    fireEvent.click(await screen.findByRole("button", { name: "Highlight links" }))
    expect(screen.getByRole("button", { name: "Highlight links" })).toHaveAttribute("aria-pressed", "true")
    expect(document.documentElement.hasAttribute("data-a11y-links")).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").links).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Larger text" }))
    expect(document.documentElement.getAttribute("data-a11y-text")).toBe("1")
    expect(screen.getByText("115%")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }))
    expect(document.documentElement.hasAttribute("data-a11y-links")).toBe(false)
    expect(document.documentElement.hasAttribute("data-a11y-text")).toBe(false)
  })

  it("opens with Alt+A where the corner button is not drawn, and gives focus back on close", async () => {
    render(<button type="button">canvas node</button>)
    renderMenu("/editor/abc")
    expect(screen.queryByRole("button", { name: "Accessibility menu" })).toBeNull()
    expect(document.documentElement.hasAttribute("data-a11y-canvas")).toBe(true)
    const node = screen.getByRole("button", { name: "canvas node" })
    node.focus()
    press("KeyA")
    const dialog = await screen.findByRole("dialog", { name: "Accessibility" })
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Accessibility" })).toBeNull())
    expect(document.activeElement).toBe(node)
  })

  it("keeps the editor's text size off the canvas pages only", () => {
    const { rerender, onNavigate } = renderMenu("/editor/abc")
    expect(document.documentElement.hasAttribute("data-a11y-canvas")).toBe(true)
    rerender(<AccessibilityMenu pathname="/templates" showStatementLink onNavigate={onNavigate} />)
    expect(document.documentElement.hasAttribute("data-a11y-canvas")).toBe(false)
  })

  it("hides the corner button for a while, Alt+A still opens the menu, and it can come back", async () => {
    renderMenu()
    fireEvent.click(screen.getByRole("button", { name: "Accessibility menu" }))
    fireEvent.click(await screen.findByRole("button", { name: "3 months" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Accessibility menu" })).toBeNull())
    expect(Number(window.localStorage.getItem("nodaro.a11y.button-hidden-until"))).toBeGreaterThan(Date.now())

    press("KeyA")
    expect(await screen.findByText(/The button is hidden until/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show it again" }))
    expect(screen.getByRole("button", { name: "Accessibility menu" })).toBeInTheDocument()
    expect(window.localStorage.getItem("nodaro.a11y.button-hidden-until")).toBeNull()
  })

  it("links to the statement through the router", async () => {
    const { onNavigate } = renderMenu()
    fireEvent.click(screen.getByRole("button", { name: "Accessibility menu" }))
    fireEvent.click(await screen.findByRole("link", { name: "Accessibility statement" }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/accessibility"))
  })
})

describe("menu shortcut and placement", () => {
  it("is Alt+A only, and never while typing", () => {
    const key = (init: KeyboardEventInit, target?: Element) => {
      const event = new KeyboardEvent("keydown", { code: "KeyA", ...init })
      if (target) Object.defineProperty(event, "target", { value: target })
      return event
    }
    expect(isMenuShortcut(key({ altKey: true }))).toBe(true)
    expect(isMenuShortcut(key({ altKey: true, ctrlKey: true }))).toBe(false)
    expect(isMenuShortcut(key({}))).toBe(false)
    expect(isMenuShortcut(key({ altKey: true }, document.createElement("textarea")))).toBe(false)
  })

  it("stays shut over a modal window, whose focus trap would keep the keyboard out", () => {
    const page = document.createElement("div")
    const modal = document.createElement("div")
    modal.setAttribute("role", "dialog")
    modal.setAttribute("aria-modal", "true")
    page.append(modal)
    expect(isMenuShortcut(new KeyboardEvent("keydown", { code: "KeyA", altKey: true }), page)).toBe(false)
  })

  it("leaves the canvas corners alone", () => {
    expect(buttonHiddenOn("/editor/w1")).toBe(true)
    expect(buttonHiddenOn("/projects/p1/workflows/w1")).toBe(true)
    expect(buttonHiddenOn("/embed/app")).toBe(true)
    expect(buttonHiddenOn("/projects")).toBe(false)
    expect(buttonHiddenOn("/app/my-app")).toBe(false)
  })
})
