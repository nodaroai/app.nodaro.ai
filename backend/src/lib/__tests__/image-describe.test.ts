/**
 * The describe call prefetches the image into bytes (some CDNs refuse a
 * provider's own fetch). On a Gemini model served by KIE those bytes travel
 * inline wherever the image is hosted — our own CDN or a social CDN alike —
 * because KIE's chat-completions lane fails every image sent as a URL.
 * Exercised through the real LLM client, with only the network edges stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import sharp from "sharp"

vi.mock("../config.js", () => ({
  // KIE only: no Anthropic key and no Gemini key, so the KIE leg is the only one.
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))
vi.mock("../anthropic.js", () => ({ getAnthropicClient: () => ({}) }))
const safeFetch = vi.fn()
vi.mock("../safe-fetch.js", () => ({ safeFetch }))

const { describeImageWithLlm } = await import("../image-describe.js")

const OWN_CDN_IMAGE = "https://cdn.example/images/portrait.png"
const SOCIAL_CDN_IMAGE = "https://scontent-lhr8-1.cdninstagram.com/v/t51.2885-15/portrait.jpg"

let fetchMock: ReturnType<typeof vi.fn>
let png: Buffer

beforeEach(async () => {
  png = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#5070a0" } }).png().toBuffer()
  safeFetch.mockReset().mockImplementation(async () =>
    new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }),
  )
  fetchMock = vi.fn().mockImplementation(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "A portrait." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 900, completion_tokens: 4 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  )
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("describeImageWithLlm on a Gemini model served by KIE", () => {
  it.each([
    ["our own CDN", OWN_CDN_IMAGE],
    ["a social CDN", SOCIAL_CDN_IMAGE],
  ])("sends an image from %s inline — never its URL — and reports the lane", async (_label, imageUrl) => {
    const res = await describeImageWithLlm({ imageUrl, llmModel: "gemini-3.8-flash", detailLevel: "brief" })

    expect(res.text).toBe("A portrait.")
    expect(res.lane).toBe("kie")
    expect(safeFetch).toHaveBeenCalledWith(imageUrl, expect.anything())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const raw = (fetchMock.mock.calls[0]?.[1] as { body: string }).body
    const body = JSON.parse(raw) as { messages: Array<{ role: string; content: unknown }> }
    const user = body.messages.find((m) => m.role === "user")
    expect((user?.content as Array<Record<string, unknown>>)[0]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
    })
    expect(raw).not.toContain(imageUrl)
  })
})
