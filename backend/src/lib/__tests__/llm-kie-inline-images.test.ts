/**
 * What each lane receives for an image, end to end through the real LLM client.
 *
 * KIE's OpenAI-shaped lanes (chat-completions, responses) never receive an
 * image URL: on those lanes KIE answered every image sent as a URL with
 * `code 500: Network error`, while the same images inline read fine. So every
 * image reaches them as a `data:` URL within KIE_INLINE_DATA_URL_MAX_CHARS —
 * resized when it would not fit, fetched first when it arrived as a URL.
 * Every other lane keeps the blocks it was given.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import sharp from "sharp"
import { randomBytes } from "node:crypto"
import { z } from "zod"
import type { LlmContentBlock } from "../llm-client.js"

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
const safeFetchBytes = vi.fn()
vi.mock("../safe-fetch-bytes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../safe-fetch-bytes.js")>()),
  safeFetchBytes,
}))

const { KIE_INLINE_DATA_URL_MAX_CHARS } = await import("../kie-inline-image.js")
const { LlmLaneError } = await import("../llm-errors.js")

const IMAGE_URL = "https://cdn.example/images/portrait.png"

let smallPng: Buffer
let twoMbPng: Buffer

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
}

const CHAT_COMPLETIONS_OK = () =>
  jsonResponse({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } })

const RESPONSES_OK = () =>
  jsonResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 3, output_tokens: 1 } })

const MESSAGES_STREAM_OK = () =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"ok"}}\n'))
        controller.enqueue(encoder.encode('data: {"type":"message_delta","usage":{"input_tokens":3,"output_tokens":1}}\n'))
        controller.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )

const bytesBlock = (bytes: Buffer, mediaType = "image/png"): LlmContentBlock => ({
  type: "image_base64",
  mediaType,
  data: bytes.toString("base64"),
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  smallPng ??= await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } }).png().toBuffer()
  twoMbPng ??= await sharp(randomBytes(820 * 820 * 3), { raw: { width: 820, height: 820, channels: 3 } }).png().toBuffer()
  safeFetchBytes.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Send `block` plus a text part on `modelId`; return the response and the wire body KIE received. */
async function send(modelId: string, block: LlmContentBlock) {
  const { llmComplete } = await import("../llm-client.js")
  const res = await llmComplete({ modelId, system: "", messages: [{ role: "user", content: [block, { type: "text", text: "describe" }] }] })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const raw = (fetchMock.mock.calls[0]?.[1] as { body: string }).body
  return { res, raw, json: JSON.parse(raw) as Record<string, unknown> }
}

describe.each([
  {
    lane: "KIE chat-completions (Gemini)",
    modelId: "gemini-3.8-flash",
    ok: CHAT_COMPLETIONS_OK,
    imageUrlSent: (json: Record<string, unknown>) =>
      (((json.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content)[0].image_url as { url: string }).url,
  },
  {
    lane: "KIE responses (GPT)",
    modelId: "gpt-5.4",
    ok: RESPONSES_OK,
    imageUrlSent: (json: Record<string, unknown>) =>
      ((json.input as Array<{ content: Array<Record<string, unknown>> }>)[0].content)[0].image_url as string,
  },
])("$lane — every image inline, never a URL", ({ modelId, ok, imageUrlSent }) => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => ok())
  })

  it("sends a small image's bytes exactly as given", async () => {
    const { res, json } = await send(modelId, bytesBlock(smallPng))

    expect(imageUrlSent(json)).toBe(`data:image/png;base64,${smallPng.toString("base64")}`)
    expect(res.lane).toBe("kie")
  })

  it("sends a 2 MB PNG as a resized JPEG data URL within the limit", async () => {
    const { raw, json } = await send(modelId, bytesBlock(twoMbPng))

    const sent = imageUrlSent(json)
    expect(sent.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(sent.length).toBeLessThanOrEqual(KIE_INLINE_DATA_URL_MAX_CHARS)
    expect(raw).not.toContain(twoMbPng.toString("base64").slice(0, 200))
  })

  it("fetches an image URL once and sends its bytes inline — the URL never reaches KIE", async () => {
    safeFetchBytes.mockResolvedValue(smallPng)

    const { raw, json } = await send(modelId, { type: "image", url: IMAGE_URL })

    expect(safeFetchBytes).toHaveBeenCalledTimes(1)
    expect(safeFetchBytes.mock.calls[0]?.[0]).toBe(IMAGE_URL)
    expect(imageUrlSent(json)).toBe(`data:image/png;base64,${smallPng.toString("base64")}`)
    expect(raw).not.toContain("cdn.example")
  })

  it("fails on KIE's side, before any KIE request, when an image URL cannot be fetched", async () => {
    safeFetchBytes.mockRejectedValue(new Error("Image download failed"))
    const { llmComplete } = await import("../llm-client.js")

    const err = await llmComplete({ modelId, system: "", messages: [{ role: "user", content: [{ type: "image", url: IMAGE_URL }] }] })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmLaneError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("the Anthropic lanes keep the blocks they were given", () => {
  it("KIE messages (Claude) sends a 2 MB PNG's bytes verbatim and an image URL as a URL source", async () => {
    fetchMock.mockImplementation(async () => MESSAGES_STREAM_OK())
    const { llmComplete } = await import("../llm-client.js")

    const res = await llmComplete({
      modelId: "claude-sonnet-4.6",
      system: "",
      messages: [{ role: "user", content: [bytesBlock(twoMbPng), { type: "image", url: IMAGE_URL }] }],
    })

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    expect(body.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: twoMbPng.toString("base64") },
    })
    expect(body.messages[0].content[1]).toEqual({ type: "image", source: { type: "url", url: IMAGE_URL } })
    expect(safeFetchBytes).not.toHaveBeenCalled()
    expect(res.lane).toBe("kie")
  })

  it("the direct SDK mapping sends the bytes verbatim", async () => {
    const { llmBlockToAnthropic } = await import("../llm-client.js")

    expect(llmBlockToAnthropic(bytesBlock(twoMbPng))).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: twoMbPng.toString("base64") },
    })
  })
})

const chatCompletionsStreamOk = () =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })

const responsesStreamOk = () =>
  new Response(
    [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 1 } } })}\n`,
    ].join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )

// The streaming entry point has its own way into each KIE format; an image
// URL must be inlined on both, or the builder refuses it.
describe.each([
  { lane: "KIE chat-completions stream (Gemini)", modelId: "gemini-3.8-flash", ok: chatCompletionsStreamOk, path: "messages" },
  { lane: "KIE responses stream (GPT)", modelId: "gpt-5.4", ok: responsesStreamOk, path: "input" },
])("llmStream on $lane — images inline here too", ({ modelId, ok, path }) => {
  it("fetches an image URL and streams the request with its bytes inline, under the caller's signal", async () => {
    const { llmStream } = await import("../llm-client.js")
    safeFetchBytes.mockResolvedValue(smallPng)
    fetchMock.mockImplementation(async () => ok())
    const controller = new AbortController()

    const res = await llmStream(
      { modelId, system: "", messages: [{ role: "user", content: [{ type: "image", url: IMAGE_URL }, { type: "text", text: "describe" }] }] },
      () => {},
      controller.signal,
    )

    expect(res.lane).toBe("kie")
    expect(safeFetchBytes).toHaveBeenCalledTimes(1)
    expect(safeFetchBytes.mock.calls[0]?.[2]).toBe(controller.signal)
    const raw = (fetchMock.mock.calls[0]?.[1] as { body: string }).body
    const body = JSON.parse(raw) as Record<string, Array<{ content: Array<Record<string, unknown>> }>>
    const part = body[path][0].content[0]
    const sent = path === "messages" ? (part.image_url as { url: string }).url : (part.image_url as string)
    expect(sent).toBe(`data:image/png;base64,${smallPng.toString("base64")}`)
    expect(raw).not.toContain("cdn.example")
  })
})

describe("a structured call inlines its images once, not once per attempt", () => {
  it("re-asks after an invalid answer without fetching the image again", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    safeFetchBytes.mockResolvedValue(smallPng)
    fetchMock
      .mockImplementationOnce(async () =>
        jsonResponse({ choices: [{ message: { role: "assistant", content: "not json" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
      )
      .mockImplementationOnce(async () =>
        jsonResponse({ choices: [{ message: { role: "assistant", content: JSON.stringify({ ok: true }) } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
      )

    const out = await llmCompleteStructured(
      { modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user", content: [{ type: "image", url: IMAGE_URL }, { type: "text", text: "rate" }] }] },
      z.object({ ok: z.boolean() }),
    )

    expect(out.output).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(safeFetchBytes).toHaveBeenCalledTimes(1)
  })
})
