// @vitest-environment node
/**
 * `node-colors.ts` composites the alpha sticky-note tints onto the canvas
 * ground to decide light-vs-dark ink, so it carries a copy of `--canvas-bg`.
 * The value the canvas actually paints lives in globals.css. A hand-kept
 * mirror drifts (it did, the day it was introduced) — so this reads the CSS
 * and pins the two together, the same way surface-profile-drift.test.ts pins
 * the frontend and backend tab lists.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CANVAS_BG } from "../node-colors"

const css = readFileSync(join(__dirname, "..", "..", "globals.css"), "utf8")

function canvasBgIn(block: string): string {
  const m = /--canvas-bg:\s*(#[0-9a-fA-F]{6})\s*;/.exec(block)
  if (!m) throw new Error("--canvas-bg not found in block")
  return m[1].toLowerCase()
}

/** The `:root { … }` (light) and `.dark { … }` (dark) token blocks. */
function tokenBlock(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `${selector} token block must exist in globals.css`).toBeGreaterThan(-1)
  const end = css.indexOf("\n}", start)
  return css.slice(start, end)
}

describe("CANVAS_BG mirrors --canvas-bg", () => {
  it("light", () => {
    expect(CANVAS_BG.light.toLowerCase()).toBe(canvasBgIn(tokenBlock(":root")))
  })
  it("dark", () => {
    expect(CANVAS_BG.dark.toLowerCase()).toBe(canvasBgIn(tokenBlock(".dark")))
  })
})
