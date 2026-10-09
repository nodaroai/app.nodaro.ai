/**
 * The describe call prefetches the image into bytes (some CDNs refuse a
 * provider's own fetch), so the bytes block also names the URL they came from.
 * On a Gemini model served by KIE that decides the wire: an image on our own
 * media host goes by URL (KIE refuses a large inline `data:` URL), while a
 * small one from any other host — a social CDN that may refuse KIE's fetch —
 * keeps travelling as the bytes the prefetch exists to send. Exercised through
 * the real LLM client, with only the network edges stubbed.
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

/** Our media host (R2_PUBLIC_URL, stubbed below). */
const OWN_ORIGIN = "https://cdn.example"
const OWN_IMAGE = `${OWN_ORIGIN}/images/portrait.png`
const SOCIAL_CDN_IMAGE = "https://scontent-lhr8-1.cdninstagram.com/v/t51.2885-15/portrait.jpg"

let fetchMock: ReturnType<typeof vi.fn>
let png: Buffer

beforeEach(async () => {
  vi.stubEnv("R2_PUBLIC_URL", OWN_ORIGIN)
  vi.stubEnv("R2_PUBLIC_FALLBACK_DOMAIN", "")
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
  vi.unstubAllEnvs()
})

/** Describe `imageUrl` on Gemini via KIE; return the raw body and the image part KIE received. */
async function describeAndCapture(imageUrl: string) {
  const res = await describeImageWithLlm({ imageUrl, llmModel: "gemini-3.8-flash", detailLevel: "brief" })
  expect(res.text).toBe("A portrait.")
  expect(safeFetch).toHaveBeenCalledWith(imageUrl, expect.anything())
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const raw = (fetchMock.mock.calls[0]?.[1] as { body: string }).body
  const body = JSON.parse(raw) as { messages: Array<{ role: string; content: unknown }> }
  const user = body.messages.find((m) => m.role === "user")
  return { raw, image: (user?.content as Array<Record<string, unknown>>)[0] }
}

describe("describeImageWithLlm on a Gemini model served by KIE", () => {
  it("sends an image on our media host by its https URL, not as inline bytes", async () => {
    const { raw, image } = await describeAndCapture(OWN_IMAGE)

    expect(image).toEqual({ type: "image_url", image_url: { url: OWN_IMAGE } })
    expect(raw).not.toContain("data:")
  })

  it("keeps a small social-CDN image inline — that host may refuse KIE's own fetch", async () => {
    const { raw, image } = await describeAndCapture(SOCIAL_CDN_IMAGE)

    expect(image).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } })
    expect(raw).not.toContain(SOCIAL_CDN_IMAGE)
  })
})
