import { describe, it, expect } from "vitest"
import { snippetCreateBody, snippetPatchBody } from "../prompt-snippets.js"

describe("prompt-snippets schemas", () => {
  const valid = {
    name: "My Lighting",
    text: "soft window light, gentle shadows",
    target: "prompt",
    media: ["image", "video"],
  }

  it("accepts a valid create body (category/description/sortOrder optional)", () => {
    expect(snippetCreateBody.safeParse(valid).success).toBe(true)
    expect(snippetCreateBody.safeParse({ ...valid, description: "d", category: "Lighting", sortOrder: 3 }).success).toBe(true)
    expect(snippetCreateBody.safeParse({ ...valid, media: [] }).success).toBe(true) // empty = all
  })

  it("rejects forbidden characters and newlines in text", () => {
    for (const bad of ["has {brace}", "has @mention", "line\nbreak"]) {
      expect(snippetCreateBody.safeParse({ ...valid, text: bad }).success).toBe(false)
    }
  })

  it("enforces lengths and enums", () => {
    expect(snippetCreateBody.safeParse({ ...valid, name: "" }).success).toBe(false)
    expect(snippetCreateBody.safeParse({ ...valid, name: "x".repeat(81) }).success).toBe(false)
    expect(snippetCreateBody.safeParse({ ...valid, text: "x".repeat(2001) }).success).toBe(false)
    expect(snippetCreateBody.safeParse({ ...valid, target: "both" }).success).toBe(false)
    expect(snippetCreateBody.safeParse({ ...valid, media: ["gif"] }).success).toBe(false)
  })

  it("patch body allows partial updates with same constraints", () => {
    expect(snippetPatchBody.safeParse({ name: "Renamed" }).success).toBe(true)
    expect(snippetPatchBody.safeParse({ text: "bad {brace}" }).success).toBe(false)
  })
})
