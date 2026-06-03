import { describe, it, expect } from "vitest"
import { modelSearchHaystack, modelMatchesQuery } from "../model-search"

/** Convenience: build the haystack for a model and test a query against it. */
function hit(value: string, label: string, desc: string, query: string): boolean {
  return modelMatchesQuery(modelSearchHaystack(value, label, desc), query)
}

describe("modelMatchesQuery", () => {
  it("matches by model name", () => {
    expect(hit("nano-banana-pro", "Nano Banana Pro", "", "banana")).toBe(true)
    expect(hit("flux", "Flux", "Photorealistic", "banana")).toBe(false)
  })

  it("matches by company / family", () => {
    expect(hit("nano-banana-pro", "Nano Banana Pro", "", "google")).toBe(true)
    expect(hit("flux", "Flux", "", "google")).toBe(false)
  })

  it("matches by aspect ratio", () => {
    expect(hit("nano-banana-pro", "Nano Banana Pro", "", "16:9")).toBe(true)
  })

  it("matches by image resolution (case-insensitive)", () => {
    expect(hit("nano-banana-pro", "Nano Banana Pro", "", "2k")).toBe(true)
    expect(hit("nano-banana-pro", "Nano Banana Pro", "", "2K")).toBe(true)
  })

  it("matches by video size (resolution in p)", () => {
    expect(hit("seedance-2", "Seedance 2", "", "720")).toBe(true)
  })

  it("matches by video length (duration)", () => {
    expect(hit("veo3", "VEO 3.1", "", "8s")).toBe(true)
    expect(hit("veo3", "VEO 3.1", "", "30s")).toBe(false)
  })

  it("AND-matches multiple whitespace-separated tokens", () => {
    expect(hit("seedance-2", "Seedance 2", "", "bytedance 720")).toBe(true)
    expect(hit("seedance-2", "Seedance 2", "", "google 720")).toBe(false)
  })

  it("resolves family for aliased ids via base-id fallback", () => {
    // "veo3.1" is not a catalog id; stripping ".1" -> "veo3" -> family Google.
    expect(hit("veo3.1", "VEO 3.1 (Fast)", "", "google")).toBe(true)
  })

  it("treats an empty / whitespace query as match-all", () => {
    expect(hit("flux", "Flux", "", "")).toBe(true)
    expect(hit("flux", "Flux", "", "   ")).toBe(true)
  })
})
