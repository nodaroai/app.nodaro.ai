import { describe, expect, it } from "vitest"
import { directRunDrawsFaceMesh, directRunPromptShape } from "../nodaro-motion-motion.js"

describe("directRunDrawsFaceMesh", () => {
  const MESH = { mode: "always" as const, faceMesh: true }
  it("Precise: the engine's masking setting", () => {
    expect(directRunDrawsFaceMesh("precise", undefined, MESH)).toBe(true)
    expect(directRunDrawsFaceMesh("precise", { masking: { mode: "always" } } as never, MESH)).toBe(true)
    expect(directRunDrawsFaceMesh("precise", undefined, { mode: "always", faceMesh: false })).toBe(false)
    expect(directRunDrawsFaceMesh("precise", undefined, { mode: "off", faceMesh: true })).toBe(false)
    expect(directRunDrawsFaceMesh("precise", undefined, undefined)).toBe(false)
  })
  it("Motion: its own masking, else the Precise masking it falls back to", () => {
    expect(directRunDrawsFaceMesh("motion", { masking: { mode: "always", source: "full-depth", faceMesh: true } } as never, undefined)).toBe(true)
    expect(directRunDrawsFaceMesh("motion", { masking: { mode: "always" } } as never, MESH)).toBe(false)
    expect(directRunDrawsFaceMesh("motion", { promptStyle: "flexible" } as never, MESH)).toBe(true)
    expect(directRunDrawsFaceMesh("motion", undefined, MESH)).toBe(true)
  })
  it("the prompt shape itself never carries it (the request adds it)", () => {
    expect(directRunPromptShape("motion", { masking: { mode: "always", faceMesh: true } } as never)).not.toHaveProperty("faceMesh")
  })
})
