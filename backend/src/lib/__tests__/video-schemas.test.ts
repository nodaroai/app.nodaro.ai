import { describe, it, expect } from "vitest"
import { shotsSchema, elementsSchema } from "../video-schemas.js"

// ── shotsSchema ──────────────────────────────────────────────────────────

describe("shotsSchema", () => {
  it("accepts a valid shot", () => {
    const result = shotsSchema.safeParse([{ prompt: "A scene", duration: 5 }])
    expect(result.success).toBe(true)
  })

  it("rejects shot prompt exceeding 500 characters", () => {
    const longPrompt = "x".repeat(501)
    const result = shotsSchema.safeParse([{ prompt: longPrompt, duration: 5 }])
    expect(result.success).toBe(false)
  })

  it("rejects shot duration of 0", () => {
    const result = shotsSchema.safeParse([{ prompt: "A scene", duration: 0 }])
    expect(result.success).toBe(false)
  })

  it("rejects shot duration of 13", () => {
    const result = shotsSchema.safeParse([{ prompt: "A scene", duration: 13 }])
    expect(result.success).toBe(false)
  })

  it("rejects more than 6 shots", () => {
    const shots = Array.from({ length: 7 }, (_, i) => ({
      prompt: `Shot ${i}`,
      duration: 3,
    }))
    const result = shotsSchema.safeParse(shots)
    expect(result.success).toBe(false)
  })

  it("accepts an empty shots array", () => {
    const result = shotsSchema.safeParse([])
    expect(result.success).toBe(true)
  })
})

// ── elementsSchema ───────────────────────────────────────────────────────

describe("elementsSchema", () => {
  it("accepts a valid image element with 2 URLs", () => {
    const result = elementsSchema.safeParse([
      {
        name: "dog",
        description: "A dog",
        type: "image",
        urls: ["https://a.com/1.jpg", "https://a.com/2.jpg"],
      },
    ])
    expect(result.success).toBe(true)
  })

  it("rejects image element with only 1 URL (needs 2-4)", () => {
    const result = elementsSchema.safeParse([
      {
        name: "dog",
        description: "A dog",
        type: "image",
        urls: ["https://a.com/1.jpg"],
      },
    ])
    expect(result.success).toBe(false)
  })

  it("accepts a video element with exactly 1 URL", () => {
    const result = elementsSchema.safeParse([
      {
        name: "clip",
        description: "A clip",
        type: "video",
        urls: ["https://a.com/v.mp4"],
      },
    ])
    expect(result.success).toBe(true)
  })

  it("rejects video element with 2 URLs (needs exactly 1)", () => {
    const result = elementsSchema.safeParse([
      {
        name: "clip",
        description: "A clip",
        type: "video",
        urls: ["https://a.com/v1.mp4", "https://a.com/v2.mp4"],
      },
    ])
    expect(result.success).toBe(false)
  })

  it("rejects more than 5 elements", () => {
    const elements = Array.from({ length: 6 }, (_, i) => ({
      name: `el${i}`,
      description: "desc",
      type: "video" as const,
      urls: ["https://a.com/v.mp4"],
    }))
    const result = elementsSchema.safeParse(elements)
    expect(result.success).toBe(false)
  })

  it("rejects element with empty description", () => {
    const result = elementsSchema.safeParse([
      {
        name: "dog",
        description: "",
        type: "video",
        urls: ["https://a.com/v.mp4"],
      },
    ])
    expect(result.success).toBe(false)
  })

  it("rejects element name exceeding 50 characters", () => {
    const result = elementsSchema.safeParse([
      {
        name: "x".repeat(51),
        description: "A dog",
        type: "video",
        urls: ["https://a.com/v.mp4"],
      },
    ])
    expect(result.success).toBe(false)
  })
})
