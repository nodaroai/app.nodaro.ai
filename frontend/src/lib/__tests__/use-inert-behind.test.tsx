import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { useRef } from "react"
import { createPortal } from "react-dom"
import { useInertBehind, KEEP_INTERACTIVE_ATTR } from "../use-inert-behind"

/**
 * A full-screen editor keeps the keyboard and the screen reader inside it
 * (WCAG 2.4.3): the page behind is inert while it is open, focus moves in and
 * comes back to the opener, and the toasts stay live.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

function Editor() {
  const ref = useRef<HTMLDivElement>(null)
  useInertBehind(ref)
  return createPortal(<div ref={ref} role="dialog" aria-label="Editor" />, document.body)
}

function setupPage() {
  const app = document.createElement("div")
  const opener = document.createElement("button")
  app.appendChild(opener)
  const toasts = document.createElement("div")
  toasts.setAttribute(KEEP_INTERACTIVE_ATTR, "")
  const alreadyInert = document.createElement("div")
  alreadyInert.setAttribute("inert", "")
  document.body.append(app, toasts, alreadyInert)
  opener.focus()
  return { app, opener, toasts, alreadyInert }
}

describe("useInertBehind", () => {
  it("makes the page behind inert, moves focus in, and gives both back on close", () => {
    const { app, opener, toasts, alreadyInert } = setupPage()
    const { unmount } = render(<Editor />, { container: document.createElement("div") })
    expect(app).toHaveAttribute("inert")
    expect(toasts).not.toHaveAttribute("inert")
    expect(document.activeElement).toBe(document.querySelector("[role=dialog]"))
    unmount()
    expect(app).not.toHaveAttribute("inert")
    expect(alreadyInert).toHaveAttribute("inert")
    expect(document.activeElement).toBe(opener)
  })
})
