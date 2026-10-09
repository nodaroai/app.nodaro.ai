/**
 * How an `image_base64` block reaches each lane once it names its source URL.
 *
 * KIE's OpenAI-shaped lanes (chat-completions, responses) carry an image only
 * as a URL, so bytes travel as a `data:` URL — and KIE refuses one past a size
 * it does not document ("Inline data URL is too large. Upload the file and pass
 * an HTTP(S) URL instead."). Those two lanes therefore choose per source:
 *
 *   - a downscaled copy whose data URL is within KIE_INLINE_DATA_URL_MAX_CHARS
 *     → the bytes, wherever the original lives (the resized copy is what
 *     worked before; the original may be far larger);
 *   - our own media host → the URL, whatever the size;
 *   - another public https host → the bytes while the data URL is within
 *     KIE_INLINE_DATA_URL_MAX_CHARS, the URL only past it;
 *   - a host KIE cannot reach (localhost, private, plain http) → the bytes,
 *     always.
 *
 * Every other lane keeps the bytes: the Anthropic ones (KIE messages, direct
 * SDK) are why the bytes exist, and the direct Gemini lane inlines them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { LlmContentBlock } from "../llm-client.js"

vi.mock("../config.js", () => ({
  // KIE_API_BASE_URL is what providers/kie/client.ts builds KIE_API_BASE from.
  // No ANTHROPIC_API_KEY and no GEMINI_API_KEY: every call here is KIE's.
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))

vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({}),
}))

const { KIE_INLINE_DATA_URL_MAX_CHARS } = await import("../llm-client.js")

/** This install's media host — what R2_PUBLIC_URL names. */
const OWN_ORIGIN = "https://media.own.example"
const OWN_SOURCE = `${OWN_ORIGIN}/images/portrait.png`
/** A public host that is not ours. */
const ELSEWHERE_SOURCE = "https://images.elsewhere.example/portrait.png"

const BYTES = "iVBORw0KGgoAAAANSUhEUgAAAAE="
const DATA_PREFIX = "data:image/png;base64,"
const DATA_URL = `${DATA_PREFIX}${BYTES}`

function bytesBlock(sourceUrl?: string): LlmContentBlock {
  return { type: "image_base64", mediaType: "image/png", data: BYTES, ...(sourceUrl !== undefined ? { sourceUrl } : {}) }
}

/** A bytes block whose data URL is exactly `chars` characters long. */
function bytesBlockOfDataUrlLength(chars: number, sourceUrl?: string): LlmContentBlock {
  const data = "A".repeat(chars - DATA_PREFIX.length)
  return { type: "image_base64", mediaType: "image/png", data, ...(sourceUrl !== undefined ? { sourceUrl } : {}) }
}

/** The same block, marked as a downscaled copy of the image at its source. */
function downscaled(block: LlmContentBlock): LlmContentBlock {
  return { ...block, downscaled: true } as LlmContentBlock
}

const AT_LIMIT = KIE_INLINE_DATA_URL_MAX_CHARS
const PAST_LIMIT = KIE_INLINE_DATA_URL_MAX_CHARS + 1

/**
 * Sources KIE could never fetch. The first is what a self-host install's own
 * storage looks like (the app origin proxying its bucket) — a URL this server
 * fetches on purpose, so the prefetch succeeds and the block names it.
 */
const UNREACHABLE: Array<[string, string]> = [
  ["self-host storage behind the app origin", "http://localhost:3000/storage/nodaro-assets/a.png"],
  ["loopback over https", "https://127.0.0.1/a.png"],
  ["a .localhost name", "https://app.localhost/a.png"],
  ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/a.png"],
  ["a private address", "https://10.0.0.7/a.png"],
  ["a container-network name", "https://minio/a.png"],
  ["an .internal name", "https://storage.corp.internal/a.png"],
  ["plain http on a public host", "http://images.elsewhere.example/a.png"],
  ["a string that is not a URL", "portrait.png"],
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

const CHAT_COMPLETIONS_OK = () =>
  jsonResponse({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } })

const RESPONSES_OK = () =>
  jsonResponse({
    output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
    usage: { input_tokens: 3, output_tokens: 1 },
  })

const MESSAGES_STREAM_OK = () =>
  sseResponse([
    'data: {"type":"content_block_delta","delta":{"text":"ok"}}\n',
    'data: {"type":"message_delta","usage":{"input_tokens":3,"output_tokens":1}}\n',
  ])

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  // Our media host is whatever R2_PUBLIC_URL names (read at call time).
  vi.stubEnv("R2_PUBLIC_URL", OWN_ORIGIN)
  vi.stubEnv("R2_PUBLIC_FALLBACK_DOMAIN", "")
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Send one image block (plus a text part) on `modelId`; return the wire body KIE received. */
async function wireBody(modelId: string, block: LlmContentBlock): Promise<{ raw: string; json: Record<string, unknown> }> {
  const { llmComplete } = await import("../llm-client.js")
  await llmComplete({ modelId, system: "", messages: [{ role: "user", content: [block, { type: "text", text: "describe" }] }] })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const raw = (fetchMock.mock.calls[0]?.[1] as { body: string }).body
  return { raw, json: JSON.parse(raw) as Record<string, unknown> }
}

describe("the inline threshold", () => {
  it("sits under the one size KIE was seen to refuse (a 2,676,538-character data URL)", () => {
    expect(KIE_INLINE_DATA_URL_MAX_CHARS).toBeLessThan(2_676_538)
  })
})

describe("KIE chat-completions (Gemini)", () => {
  const imageUrlSent = (json: Record<string, unknown>) =>
    (((json.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content)[0].image_url as { url: string }).url

  beforeEach(() => {
    fetchMock.mockImplementation(async () => CHAT_COMPLETIONS_OK())
  })

  it("sends an image on our media host by URL, however small", async () => {
    const { raw, json } = await wireBody("gemini-3.8-flash", bytesBlock(OWN_SOURCE))

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions")
    expect(imageUrlSent(json)).toBe(OWN_SOURCE)
    expect(raw).not.toContain("data:")
    expect(raw).not.toContain(BYTES)
  })

  it("sends an image on our media host by URL past the threshold too", async () => {
    const { json } = await wireBody("gemini-3.8-flash", bytesBlockOfDataUrlLength(PAST_LIMIT, OWN_SOURCE))

    expect(imageUrlSent(json)).toBe(OWN_SOURCE)
  })

  it("keeps a small image from another host inline", async () => {
    const { raw, json } = await wireBody("gemini-3.8-flash", bytesBlock(ELSEWHERE_SOURCE))

    expect(imageUrlSent(json)).toBe(DATA_URL)
    expect(raw).not.toContain(ELSEWHERE_SOURCE)
  })

  it("keeps an image from another host inline at exactly the threshold", async () => {
    const { json } = await wireBody("gemini-3.8-flash", bytesBlockOfDataUrlLength(AT_LIMIT, ELSEWHERE_SOURCE))

    expect(imageUrlSent(json).length).toBe(AT_LIMIT)
    expect(imageUrlSent(json).startsWith(DATA_PREFIX)).toBe(true)
  })

  it("sends an image from another host by URL once its data URL is past the threshold", async () => {
    const { raw, json } = await wireBody("gemini-3.8-flash", bytesBlockOfDataUrlLength(PAST_LIMIT, ELSEWHERE_SOURCE))

    expect(imageUrlSent(json)).toBe(ELSEWHERE_SOURCE)
    expect(raw).not.toContain("data:")
  })

  it("sends a data URL when the block names no source", async () => {
    const { json } = await wireBody("gemini-3.8-flash", bytesBlock())

    expect(imageUrlSent(json)).toBe(DATA_URL)
  })

  it.each(UNREACHABLE)("sends a data URL, and never the source, for %s", async (_label, source) => {
    const { raw, json } = await wireBody("gemini-3.8-flash", bytesBlock(source))

    expect(imageUrlSent(json)).toBe(DATA_URL)
    expect(raw).not.toContain(source)
  })

  it("never sends an unreachable source, even past the threshold", async () => {
    const { raw, json } = await wireBody("gemini-3.8-flash", bytesBlockOfDataUrlLength(PAST_LIMIT, "https://10.0.0.7/a.png"))

    expect(imageUrlSent(json).startsWith(DATA_PREFIX)).toBe(true)
    expect(raw).not.toContain("10.0.0.7")
  })

  it("never sends our own self-host storage URL — our host, but one KIE cannot reach", async () => {
    vi.stubEnv("R2_PUBLIC_URL", "http://localhost:3000/storage/nodaro-assets")
    const selfHosted = "http://localhost:3000/storage/nodaro-assets/images/a.png"

    const { raw, json } = await wireBody("gemini-3.8-flash", bytesBlockOfDataUrlLength(PAST_LIMIT, selfHosted))

    expect(imageUrlSent(json).startsWith(DATA_PREFIX)).toBe(true)
    expect(raw).not.toContain(selfHosted)
  })

  it("leaves a plain image block's URL exactly as it was", async () => {
    const { json } = await wireBody("gemini-3.8-flash", { type: "image", url: ELSEWHERE_SOURCE })

    expect(imageUrlSent(json)).toBe(ELSEWHERE_SOURCE)
  })
})

describe("KIE chat-completions: a downscaled copy", () => {
  const imageUrlSent = (json: Record<string, unknown>) =>
    (((json.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content)[0].image_url as { url: string }).url

  beforeEach(() => {
    fetchMock.mockImplementation(async () => CHAT_COMPLETIONS_OK())
  })

  it("goes inline when it fits, even when the original is on our host", async () => {
    const { raw, json } = await wireBody("gemini-3.8-flash", downscaled(bytesBlock(OWN_SOURCE)))

    expect(imageUrlSent(json)).toBe(DATA_URL)
    expect(raw).not.toContain(OWN_SOURCE)
  })

  it("goes inline at exactly the threshold", async () => {
    const { json } = await wireBody("gemini-3.8-flash", downscaled(bytesBlockOfDataUrlLength(AT_LIMIT, OWN_SOURCE)))

    expect(imageUrlSent(json).startsWith(DATA_PREFIX)).toBe(true)
  })

  it("past the threshold, follows the URL rule: our host by URL", async () => {
    const { json } = await wireBody("gemini-3.8-flash", downscaled(bytesBlockOfDataUrlLength(PAST_LIMIT, OWN_SOURCE)))

    expect(imageUrlSent(json)).toBe(OWN_SOURCE)
  })

  it("past the threshold, follows the URL rule: another host by URL", async () => {
    const { json } = await wireBody("gemini-3.8-flash", downscaled(bytesBlockOfDataUrlLength(PAST_LIMIT, ELSEWHERE_SOURCE)))

    expect(imageUrlSent(json)).toBe(ELSEWHERE_SOURCE)
  })

  it("past the threshold, still never sends an unreachable source", async () => {
    const { raw, json } = await wireBody("gemini-3.8-flash", downscaled(bytesBlockOfDataUrlLength(PAST_LIMIT, "https://10.0.0.7/a.png")))

    expect(imageUrlSent(json).startsWith(DATA_PREFIX)).toBe(true)
    expect(raw).not.toContain("10.0.0.7")
  })
})

describe("KIE responses (GPT): the same rule on input_image", () => {
  const imageUrlSent = (json: Record<string, unknown>) =>
    ((json.input as Array<{ content: Array<Record<string, unknown>> }>)[0].content)[0].image_url as string

  beforeEach(() => {
    fetchMock.mockImplementation(async () => RESPONSES_OK())
  })

  it("sends an image on our media host by URL", async () => {
    const { raw, json } = await wireBody("gpt-5.4", bytesBlock(OWN_SOURCE))

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.kie.ai/codex/v1/responses")
    expect(imageUrlSent(json)).toBe(OWN_SOURCE)
    expect(raw).not.toContain("data:")
  })

  it("keeps a small image from another host inline", async () => {
    const { json } = await wireBody("gpt-5.4", bytesBlock(ELSEWHERE_SOURCE))

    expect(imageUrlSent(json)).toBe(DATA_URL)
  })

  it("keeps a downscaled copy that fits inline, even when the original is on our host", async () => {
    const { json } = await wireBody("gpt-5.4", downscaled(bytesBlock(OWN_SOURCE)))

    expect(imageUrlSent(json)).toBe(DATA_URL)
  })

  it("sends an image from another host by URL once its data URL is past the threshold", async () => {
    const { json } = await wireBody("gpt-5.4", bytesBlockOfDataUrlLength(PAST_LIMIT, ELSEWHERE_SOURCE))

    expect(imageUrlSent(json)).toBe(ELSEWHERE_SOURCE)
  })

  it("sends a data URL when the block names no source", async () => {
    const { json } = await wireBody("gpt-5.4", bytesBlock())

    expect(imageUrlSent(json)).toBe(DATA_URL)
  })

  it.each(UNREACHABLE)("sends a data URL, and never the source, for %s", async (_label, source) => {
    const { raw, json } = await wireBody("gpt-5.4", bytesBlock(source))

    expect(imageUrlSent(json)).toBe(DATA_URL)
    expect(raw).not.toContain(source)
  })
})

describe("the Anthropic lanes keep the bytes, source or not", () => {
  it("KIE messages (Claude) sends a base64 source block", async () => {
    fetchMock.mockImplementation(async () => MESSAGES_STREAM_OK())

    const { raw, json } = await wireBody("claude-sonnet-4.6", bytesBlock(OWN_SOURCE))

    const blocks = (json.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content
    expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: BYTES } })
    expect(raw).not.toContain(OWN_SOURCE)
  })

  it("the direct SDK mapping sends a base64 source block", async () => {
    const { llmBlockToAnthropic } = await import("../llm-client.js")

    expect(llmBlockToAnthropic(bytesBlock(OWN_SOURCE))).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: BYTES },
    })
  })
})
