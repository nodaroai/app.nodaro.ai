/**
 * The public Speaker View page must describe the quick strip as it ships
 * (decided 2026-10-08): Cut, Pan and Zoom are always listed and the ones the
 * rule rules out are GREYED with their reason; only the layout list removes.
 * Public Docs Maintenance Rule: a behaviour change updates docs/ in the same PR.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const doc = readFileSync(join(__dirname, "../../../../../docs/nodes/processing-video/speaker-view.md"), "utf8")

describe("docs/nodes/processing-video/speaker-view.md quick strip", () => {
  it("no longer says the strip drops what cannot run", () => {
    expect(doc).not.toMatch(/lists only what can run/i)
  })
  it("says Cut, Pan and Zoom stay listed and are greyed with a reason", () => {
    expect(doc).toMatch(/always lists Cut, Pan and Zoom/i)
    expect(doc).toMatch(/Pan and Zoom are greyed under a fixed multi-slot layout/i)
  })
  it("documents the greyed Pan row on the strip and the full stop on the reason", () => {
    expect(doc).toMatch(/Pan row in the quick strip/i)
    expect(doc).toContain('"No speaker change can pan here."')
  })
})
