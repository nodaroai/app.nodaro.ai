import { describe, it, expect, vi, afterEach } from "vitest"
import { escapeScrollLock } from "../scroll-lock-escape"

/**
 * These menus mount on `document.body`, OUTSIDE a Radix Dialog's
 * react-remove-scroll lock subtree. react-remove-scroll installs a non-passive
 * `wheel`/`touchmove` listener on `document` (bubble phase) that calls
 * `preventDefault()` on events targeting nodes outside its lock — silently
 * killing the menu's own `overflow-y-auto`. The fix stops those events at the
 * menu so they never reach `document`. These tests encode that mechanism.
 */
describe("escapeScrollLock", () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    cleanups.splice(0).forEach((c) => c())
    document.body.replaceChildren()
  })

  function mountContainerWithChild() {
    const container = document.createElement("div")
    const child = document.createElement("button")
    container.appendChild(child)
    document.body.appendChild(container)
    return { container, child }
  }

  it("stops wheel events from reaching document (where react-remove-scroll listens)", () => {
    const { container, child } = mountContainerWithChild()
    const docSpy = vi.fn()
    document.addEventListener("wheel", docSpy)

    cleanups.push(escapeScrollLock(container))
    child.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }))

    expect(docSpy).not.toHaveBeenCalled()
    document.removeEventListener("wheel", docSpy)
  })

  it("stops touchmove events from reaching document (mobile parity)", () => {
    const { container, child } = mountContainerWithChild()
    const docSpy = vi.fn()
    document.addEventListener("touchmove", docSpy)

    cleanups.push(escapeScrollLock(container))
    child.dispatchEvent(new Event("touchmove", { bubbles: true, cancelable: true }))

    expect(docSpy).not.toHaveBeenCalled()
    document.removeEventListener("touchmove", docSpy)
  })

  it("does NOT preventDefault — native scroll inside the menu is preserved", () => {
    const { container } = mountContainerWithChild()
    cleanups.push(escapeScrollLock(container))

    const ev = new Event("wheel", { bubbles: true, cancelable: true })
    container.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(false)
  })

  it("cleanup restores propagation (no leaked listeners)", () => {
    const { container, child } = mountContainerWithChild()
    const docSpy = vi.fn()
    document.addEventListener("wheel", docSpy)

    const cleanup = escapeScrollLock(container)
    cleanup()
    child.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }))

    expect(docSpy).toHaveBeenCalledTimes(1)
    document.removeEventListener("wheel", docSpy)
  })
})
