/**
 * A retired edit provider on a server-run node is refused with its reason —
 * the same sentence the direct route answers — before any credit id is built.
 * `grok-upscale` (retired 2026-10-29) never upscaled an image; a stored node
 * that still names it must not reach the credit check with an unpriced id and
 * fail as "pricing is not configured" (a platform fault, to the user's eye).
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { RETIRED_EDIT_PROVIDERS } from "../../../lib/retired-edit-providers.js"
import type { SimpleNode } from "../types.js"

const IMG = "https://cdn.example.com/photo.png"

describe("payload-builder — a retired edit provider", () => {
  it("upscale-image with grok-upscale throws the retirement reason, naming the replacement", () => {
    const node: SimpleNode = { id: "n1", type: "upscale-image", data: { provider: "grok-upscale" } }
    expect(() => buildPayload(node, "job1", { imageUrl: IMG }, "usage1")).toThrow(RETIRED_EDIT_PROVIDERS["grok-upscale"])
    expect(RETIRED_EDIT_PROVIDERS["grok-upscale"]).toMatch(/recraft-upscale or topaz-image-upscale/)
  })

  it("a legacy edit-image node carrying the provider is refused the same way", () => {
    const node: SimpleNode = { id: "n2", type: "edit-image", data: { provider: "grok-upscale" } }
    expect(() => buildPayload(node, "job2", { imageUrl: IMG }, "usage2")).toThrow(RETIRED_EDIT_PROVIDERS["grok-upscale"])
  })

  it("an inherited object name as the provider is not a retirement (own keys only)", async () => {
    const { retiredEditProviderReason } = await import("../../../lib/retired-edit-providers.js")
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(retiredEditProviderReason(name)).toBeUndefined()
    }
    expect(retiredEditProviderReason(undefined)).toBeUndefined()
    expect(retiredEditProviderReason({ provider: "grok-upscale" })).toBeUndefined()
  })

  it("a served upscale provider still builds its payload", () => {
    const node: SimpleNode = { id: "n3", type: "upscale-image", data: { provider: "recraft-upscale" } }
    const built = buildPayload(node, "job3", { imageUrl: IMG }, "usage3")
    expect(built.jobName).toBe("edit-image")
    expect(built.modelIdentifier).toBe("recraft-upscale")
  })
})
