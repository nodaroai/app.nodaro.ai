import { describe, it, expect } from "vitest"
import type { LlmContentBlock } from "../llm-client.js"

describe("LlmContentBlock type coverage", () => {
  it("supports the five block types end-to-end (compile-time)", () => {
    const blocks: LlmContentBlock[] = [
      { type: "text", text: "hi" },
      { type: "image", url: "https://x/y.png" },
      { type: "image_base64", mediaType: "image/png", data: "AAAA" },
      { type: "video", url: "https://x/y.mp4" },
      { type: "audio", url: "https://x/y.mp3" },
    ]
    expect(blocks.length).toBe(5)
  })
})
