import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The admin frame is one screen tall: the page scrolls inside <main>, never the
// document. The sidebar's menu is taller than a laptop screen, and while it
// could spill out of the frame, the document had something to scroll: a wheel
// that reached the end of a long page (Jobs, Gallery) carried on scrolling the
// document, the whole frame slid up, and the bottom of the screen was left
// empty with the page's "Load more" stranded mid-screen. jsdom has no layout,
// so this pins the two classes that keep the frame whole.
const source = readFileSync(join(__dirname, "..", "admin-layout.tsx"), "utf8")

describe("admin frame", () => {
  it("never lets the document scroll", () => {
    expect(source).toContain(`<div className="flex h-screen overflow-hidden bg-background">`)
  })

  it("scrolls the sidebar menu inside the sidebar", () => {
    expect(source).toMatch(/<nav className="[^"]*\bflex-1\b[^"]*\bmin-h-0\b[^"]*\boverflow-y-auto\b/)
  })
})
