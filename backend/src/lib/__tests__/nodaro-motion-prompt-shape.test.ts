import { describe, expect, it } from "vitest"
import { directRunDrawsFaceMesh, directRunPromptShape, shotListFlexMasking } from "../nodaro-motion-motion.js"

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

describe("an engine with the shot list: Flex is Full depth with a shot list", () => {
  const ON = { shotList: true }
  it("reads any masking that is not a Full depth's as Full depth, the scene from a description", () => {
    for (const entry of [undefined, { masking: { mode: "off" } }, { masking: { mode: "always" } }, { promptStyle: "precise" }] as never[]) {
      expect(directRunPromptShape("motion", entry, ON), JSON.stringify(entry)).toMatchObject({ source: "full-depth", scene: "description" })
    }
    expect(shotListFlexMasking(undefined)).toEqual({ mode: "always", source: "full-depth", scene: "description" })
  })
  it("always makes the shot list: original becomes description + original, none a description", () => {
    const fd = (scene?: string) => ({ masking: { mode: "always", source: "full-depth", ...(scene ? { scene } : {}) } }) as never
    expect(directRunPromptShape("motion", fd("original"), ON).scene).toBe("description-and-original")
    expect(directRunPromptShape("motion", fd("none"), ON).scene).toBe("description")
    expect(directRunPromptShape("motion", fd("description-and-original"), ON).scene).toBe("description-and-original")
    expect(directRunPromptShape("motion", fd(), ON).scene).toBe("description")
    // A Precise prompt style with Full depth stays as set.
    expect(directRunPromptShape("motion", { ...(fd() as object), promptStyle: "precise" } as never, ON).promptStyle).toBe("precise")
    // Without the capability, as before.
    expect(directRunPromptShape("motion", fd("original")).scene).toBe("original")
    expect(directRunPromptShape("motion", { masking: { mode: "always" } } as never).source).toBe("faces")
  })
  it("draws the face mesh only from Flex's own Full depth, never the Precise masking", () => {
    const MESH = { mode: "always" as const, faceMesh: true }
    expect(directRunDrawsFaceMesh("motion", undefined, MESH, ON)).toBe(false)
    expect(directRunDrawsFaceMesh("motion", { masking: { mode: "always", source: "full-depth", faceMesh: true } } as never, undefined, ON)).toBe(true)
    expect(directRunDrawsFaceMesh("precise", undefined, MESH, ON)).toBe(true)
  })
})
