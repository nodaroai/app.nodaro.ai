import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const dir = join(__dirname, "..")
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"))

describe("every blueprint is RTL-wired", () => {
  it.each(files)("%s uses a direction helper and withRtlFallback", (file) => {
    const src = readFileSync(join(dir, file), "utf8")
    // Most blueprints call directionStyle directly on their own text nodes.
    // logo-assemble-lockup instead wires direction at the row-container level
    // via its in-file logoRowDirection helper (built on detectBaseDirection) —
    // either counts as "RTL-wired".
    expect(src.includes("directionStyle") || src.includes("detectBaseDirection")).toBe(true)
    // Since the brand-fill task (Task 6), blueprints no longer call
    // withRtlFallback directly — they get it transitively via
    // blueprintFontFamily(brand), the single source of truth in lib/brand.ts
    // (which itself unconditionally applies withRtlFallback). Either form of
    // evidence proves the font stack is RTL-safe.
    expect(src.includes("withRtlFallback") || src.includes("blueprintFontFamily(brand)")).toBe(true)
  })
})
