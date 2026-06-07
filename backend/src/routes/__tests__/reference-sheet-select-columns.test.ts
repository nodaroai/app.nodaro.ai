import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
const here = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(resolve(here, "../", p), "utf8")

describe("entity GET routes select the new sheet buckets", () => {
  it("characters selects sheets, detail_closeups, outfit_variations", () => {
    const s = read("characters.ts")
    for (const c of ["sheets", "detail_closeups", "outfit_variations"]) expect(s).toContain(c)
  })
  it("objects selects sheets, detail_closeups", () => {
    const s = read("objects.ts")
    for (const c of ["sheets", "detail_closeups"]) expect(s).toContain(c)
  })
  it("locations selects sheets, detail_closeups", () => {
    const s = read("locations.ts")
    for (const c of ["sheets", "detail_closeups"]) expect(s).toContain(c)
  })
})
