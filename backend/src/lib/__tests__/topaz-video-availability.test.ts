import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ denied: new Set<string>() }))
vi.mock("../surface-deny.js", () => ({ isModelDenied: (id: string) => h.denied.has(id) }))

const { topazVideoDisabledHere } = await import("../topaz-video-availability.js")

describe("topazVideoDisabledHere", () => {
  beforeEach(() => h.denied.clear())

  it("is false while the model and its credit row run here", () => {
    expect(topazVideoDisabledHere()).toBe(false)
  })

  it("is true when the catalog model is withheld, or its per-unit credit row is switched off", () => {
    h.denied.add("topaz-video")
    expect(topazVideoDisabledHere()).toBe(true)
    h.denied.clear()
    h.denied.add("topaz-video:per-unit")
    expect(topazVideoDisabledHere()).toBe(true)
  })
})
