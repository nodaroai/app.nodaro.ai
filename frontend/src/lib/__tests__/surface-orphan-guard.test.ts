import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { ENTRY_BY_LINK, NAV_ENTRY_ROUTES } from "../surface-nav-registry"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUTER = resolve(HERE, "..", "..", "router.tsx")

describe("orphan guard — stock profile strands no nav-entry route", () => {
  it("every path: literal in router.tsx is either link-only (allowlisted) or gated by a known nav entry", () => {
    const src = readFileSync(ROUTER, "utf8")
    if (!src.includes("path:")) return // substring pre-filter: nothing to scan
    const paths = [...new Set([...src.matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]))]
    const linkOnly = new Set(ENTRY_BY_LINK)
    const gated = new Set(Object.values(NAV_ENTRY_ROUTES).flat())
    const stranded = paths.filter((p) => !linkOnly.has(p) && !gated.has(p))
    // A route that is neither link-only nor tied to a nav entry is a design gap:
    // add it to ENTRY_BY_LINK (link-only by design) or to NAV_ENTRY_ROUTES.
    expect(stranded, `unclassified routes: ${stranded.join(", ")}`).toEqual([])
  }, 10_000) // explicit ceiling — this parses one file, well under it
})

describe("N1 — gallery routes actually gate on surfaceNavHidden(\"gallery\")", () => {
  it("every NAV_ENTRY_ROUTES.gallery route registers behind the gallery surface gate", () => {
    // Registration presence is not enough: /_gallery was in NAV_ENTRY_ROUTES yet
    // mounted UNCONDITIONALLY, so a hidden-gallery deployment still loaded it
    // against a backend that skips /v1/gallery. Assert each gallery route's
    // `path:` literal sits just after a surfaceNavHidden("gallery") gate. A small
    // fixed lookbehind (not "nearest preceding gate", which false-passes off the
    // sibling /gallery gate) keeps this honest.
    const src = readFileSync(ROUTER, "utf8")
    const WINDOW = 200
    for (const route of NAV_ENTRY_ROUTES.gallery) {
      const idx = src.indexOf(`path: "${route}"`)
      expect(idx, `route ${route} not found in router.tsx`).toBeGreaterThan(-1)
      const before = src.slice(Math.max(0, idx - WINDOW), idx)
      expect(
        before.includes('surfaceNavHidden("gallery")'),
        `route ${route} is not gated by surfaceNavHidden("gallery")`,
      ).toBe(true)
    }
  }, 10_000)
})
