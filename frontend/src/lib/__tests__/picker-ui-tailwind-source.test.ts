// @vitest-environment node
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Tailwind v4 skips `node_modules` in its content scan, so `globals.css`
 * re-adds the prebuilt picker-ui bundle with an `@source` directive. NOTHING in
 * the build validates that path: a wrong one fails silently, and the only
 * symptom is that utilities used ONLY inside the package are missing from the
 * emitted CSS. It shipped wrong once (`@nodaroai` instead of `@nodaro`), which
 * stripped the category-tab count badge's horizontal padding and the tile
 * icons' size constraint while every shared utility kept working — so the
 * components looked almost right, which is why it survived review.
 *
 * This pins every `@source` path in the stylesheet to a directory that exists.
 */
const GLOBALS = resolve(dirname(fileURLToPath(import.meta.url)), "../../globals.css")

function sourceDirectives(css: string): string[] {
  return [...css.matchAll(/@source\s+"([^"]+)"/g)].map((m) => m[1])
}

describe("globals.css @source directives", () => {
  const css = readFileSync(GLOBALS, "utf8")
  const paths = sourceDirectives(css)

  it("declares at least the picker-ui bundle", () => {
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.some((p) => p.includes("picker-ui"))).toBe(true)
  })

  it.each(sourceDirectives(readFileSync(GLOBALS, "utf8")))(
    "%s resolves to a directory that exists",
    (relative) => {
      expect(existsSync(resolve(dirname(GLOBALS), relative))).toBe(true)
    },
  )

  it("names the published scope @nodaro, not @nodaroai", () => {
    const pickerPaths = paths.filter((p) => p.includes("picker-ui"))
    for (const p of pickerPaths) expect(p).not.toContain("@nodaroai/")
  })
})
