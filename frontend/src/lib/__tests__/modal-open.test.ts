import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { isModalDialogOpen, refuseDeleteUnderModal } from "../modal-open"

// One answer to "is a modal dialog open over the editor?" for every canvas
// keyboard path that must stand down while one is.

function mount(attrs: Record<string, string>) {
  const el = document.createElement("div")
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  return el
}

afterEach(() => { document.body.innerHTML = "" })

describe("isModalDialogOpen", () => {
  it("is true only for a MODAL dialog", () => {
    expect(isModalDialogOpen()).toBe(false)
    // A non-modal Radix popper carries role="dialog" too: it must not count, or
    // opening a handle popover would disable every editor shortcut.
    mount({ role: "dialog" })
    expect(isModalDialogOpen()).toBe(false)
    mount({ role: "dialog", "aria-modal": "true" })
    expect(isModalDialogOpen()).toBe(true)
  })

  it("refuses canvas deletes while one is open, and allows them otherwise", async () => {
    expect(await refuseDeleteUnderModal()).toBe(true)
    mount({ role: "dialog", "aria-modal": "true" })
    expect(await refuseDeleteUnderModal()).toBe(false)
  })
})

// The three canvas paths that ask it (review of #1789). workflow-canvas.tsx is
// thousands of lines with no harness; pin the wiring at the source.
describe("workflow-canvas stands down under a modal", () => {
  const src = readFileSync(resolve(__dirname, "../../components/editor/workflow-canvas.tsx"), "utf8")

  it("React Flow's delete key never deletes from under a modal", () => {
    expect(src).toContain("onBeforeDelete={refuseDeleteUnderModal}")
  })

  it("the shortcut gate asks the shared helper", () => {
    expect(src).toMatch(/const overlayOpen =[\s\S]{0,300}isModalDialogOpen\(\)/)
    expect(src).not.toContain(`document.querySelector('[role="dialog"][aria-modal="true"]')`)
  })

  it("Escape leaves the sidebar and menus alone while a modal is open (the modal owns it)", () => {
    const escape = src.slice(src.indexOf('if (e.key === "Escape") {'))
    const modalCheck = escape.indexOf("if (isModalDialogOpen())")
    const sidebarClose = escape.indexOf("setAddNodePopupOpen(false)")
    expect(modalCheck).toBeGreaterThan(-1)
    expect(modalCheck).toBeLessThan(sidebarClose)
  })
})
