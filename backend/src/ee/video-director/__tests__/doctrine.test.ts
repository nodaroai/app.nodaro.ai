import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
const DIR = resolve(__dirname, "../../../../skills/video-director")
const read = (f: string) => readFileSync(resolve(DIR, f), "utf-8")
describe("video-director doctrine", () => {
  it("doctrine.md has the load-bearing sections + machine contract", () => {
    const d = read("doctrine.md")
    for (const h of ["## Narrative arcs","## VO script bank","## Shot-sequence method","## Motion doctrine","## Machine contract"]) expect(d).toContain(h)
    expect(d).toMatch(/```json[\s\S]*"shotSequenceBrief"[\s\S]*```/)
    // motion doctrine must steer away from spring/bouncy
    expect(d.toLowerCase()).toContain("avoid")
    expect(d).toMatch(/easeOut|easeInOut/)
  })
  it("genre addenda exist with arc + reveal palette", () => {
    for (const f of ["explainer.md","product-launch.md"]) {
      const g = read(f); expect(g).toContain("## Arc"); expect(g).toContain("## Reveal palette")
    }
  })
})
