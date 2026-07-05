import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * License-boundary guard: @nodaro/shared is published under Apache-2.0 and
 * bundles everything it imports — an import from @nodaro/prompts
 * (Nodaro SUL) would republish proprietary creative/prompt IP under Apache.
 * Source files must never cross this boundary (tests excluded: not bundled).
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p)
    return p.endsWith(".ts") ? [p] : []
  })
}

describe("Apache boundary", () => {
  it("no shared source file imports @nodaro/prompts", () => {
    const offenders = walk(join(__dirname, ".."))
      .filter((f) => /from\s+["']@nodaro\/shared-internal["']/.test(readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
  })
})
