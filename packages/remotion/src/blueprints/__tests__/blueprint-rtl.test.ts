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
    expect(src).toContain("withRtlFallback")
  })
})
