import { describe, it, expect } from "vitest"
import { isValidLlmChatConnection } from "../audio-text-handles"
import { NODE_OPTIONS } from "../node-options"
import { NODE_DEFINITIONS } from "@/types/nodes"

const notAPicker = () => false

/**
 * The Prompt node (`llm-chat`) must take a Web Scrape's `json` output on its
 * prompt handle: both runtimes already stringify that JSON into the prompt,
 * and the connection validator was the only thing refusing the wire.
 */
describe("Prompt node accepts JSON producers on its prompt handle", () => {
  it("web-scrape → prompt is a valid connection", () => {
    expect(isValidLlmChatConnection("prompt", "web-scrape", notAPicker)).toBe(true)
  })

  it("web-scrape → system-prompt (Instructions) is a valid connection — routed by handle on both engines", () => {
    expect(isValidLlmChatConnection("system-prompt", "web-scrape", notAPicker)).toBe(true)
  })

  it("refuses web-scrape on References: both resolvers push a text-typed reference into referenceImageUrls, which the LLM route rejects", () => {
    expect(isValidLlmChatConnection("references", "web-scrape", notAPicker)).toBe(false)
  })

  it("still refuses media producers on the prompt handle", () => {
    expect(isValidLlmChatConnection("prompt", "generate-image", notAPicker)).toBe(false)
    expect(isValidLlmChatConnection("prompt", "upload-video", notAPicker)).toBe(false)
  })
})

/**
 * Renamed from "Generate Text" (Sept 2026). The picker entry must carry the
 * new label AND stay findable under the old name and the "llm" family words,
 * or people searching for what they used to see find nothing.
 */
describe("Prompt node naming", () => {
  const option = NODE_OPTIONS.find((o) => o.type === "llm-chat")
  const definition = NODE_DEFINITIONS.find((d) => d.type === "llm-chat")

  it("is labeled Generate Text - Any LLM in the picker and on a fresh node (decided 2026-10-08)", () => {
    expect(option?.label).toBe("Generate Text - Any LLM")
    expect(definition?.label).toBe("Generate Text - Any LLM")
    expect((definition?.defaultData as { label?: string } | undefined)?.label).toBe("Generate Text - Any LLM")
  })

  it("is searchable by its former name and by llm", () => {
    const kws = (option?.keywords ?? []).map((k) => k.toLowerCase())
    expect(kws).toContain("generate text")
    expect(kws).toContain("llm")
  })
})
