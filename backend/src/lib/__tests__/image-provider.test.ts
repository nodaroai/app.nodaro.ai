import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared"
import { normalizeImageProvider } from "../image-provider.js"

describe("normalizeImageProvider", () => {
  it("keeps a known MODEL_CATALOG image-model id", () => {
    expect(normalizeImageProvider("nano-banana")).toBe("nano-banana")
    expect(normalizeImageProvider("flux")).toBe("flux")
    expect(normalizeImageProvider("gpt-image")).toBe("gpt-image")
  })

  it("nulls a known NON-image model (video / audio) — kind check, not just existence", () => {
    const videoId = Object.values(MODEL_CATALOG).find((m) => m.kind === "video")?.id
    expect(videoId).toBeTruthy()
    expect(normalizeImageProvider(videoId!)).toBeNull()

    const audioId = Object.values(MODEL_CATALOG).find((m) => m.kind === "audio")?.id
    if (audioId) expect(normalizeImageProvider(audioId)).toBeNull()
  })

  it("nulls an unknown id", () => {
    expect(normalizeImageProvider("totally-not-a-model")).toBeNull()
  })

  it("nulls empty string, null, and undefined", () => {
    expect(normalizeImageProvider("")).toBeNull()
    expect(normalizeImageProvider(null)).toBeNull()
    expect(normalizeImageProvider(undefined)).toBeNull()
  })
})
