import { describe, it, expect } from "vitest"
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
