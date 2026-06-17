import { describe, it, expect, vi } from "vitest"
import { BODY_MENU_CLASS } from "../body-menu-class"

describe("BODY_MENU_CLASS", () => {
  it("includes pointer-events-auto (load-bearing inside Radix Dialog modals)", () => {
    expect(BODY_MENU_CLASS).toContain("pointer-events-auto")
  })
  it("keeps the existing menu chrome classes", () => {
    expect(BODY_MENU_CLASS).toContain("z-[10000]")
    expect(BODY_MENU_CLASS).toContain("bg-popover")
  })
})

import { createFloatingSuggestionRenderer } from "../floating-suggestion-renderer"

it("floating suggestion mount sets pointer-events:auto on the body div", () => {
  const factory = createFloatingSuggestionRenderer(340, (root) => { void root })
  const inst = factory()
  inst.onStart({ clientRect: () => new DOMRect(0, 0, 0, 0) } as never)
  const mount = document.body.querySelector("div") as HTMLDivElement
  expect(mount.style.pointerEvents).toBe("auto")
  inst.onExit()
})

it("floating suggestion mount is marked as a prompt-editor portal (modal won't close on select)", () => {
  const factory = createFloatingSuggestionRenderer(340, (root) => { void root })
  const inst = factory()
  const before = new Set(document.body.children)
  inst.onStart({ clientRect: () => new DOMRect(0, 0, 0, 0) } as never)
  const mount = [...document.body.children].find((el) => !before.has(el)) as HTMLDivElement
  expect(mount.hasAttribute("data-prompt-editor-portal")).toBe(true)
  inst.onExit()
})

it("floating suggestion mount isolates wheel from document (scroll-lock escape)", () => {
  // react-remove-scroll (Radix Dialog modal) listens for wheel on `document`
  // and cancels scroll for body-mounted nodes outside its lock. The mount must
  // stop wheel from bubbling there so the popup's overflow-y-auto can scroll.
  const factory = createFloatingSuggestionRenderer(340, (root) => { void root })
  const inst = factory()
  // Grab the freshly-appended mount, not a sibling test's deferred-removal one.
  const before = new Set(document.body.children)
  inst.onStart({ clientRect: () => new DOMRect(0, 0, 0, 0) } as never)
  const mount = [...document.body.children].find((el) => !before.has(el)) as HTMLDivElement

  const docSpy = vi.fn()
  document.addEventListener("wheel", docSpy)
  mount.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }))
  expect(docSpy).not.toHaveBeenCalled()

  document.removeEventListener("wheel", docSpy)
  inst.onExit()
})
