/**
 * End-to-end for the ONE lane that can carry inline video bytes:
 * `llmComplete` → router gate → direct Google client → `generateContent`,
 * with the real media layer in the path (only the SDK and `safeFetch` stubbed).
 *
 * `media.test.ts` pins the block→`Part` mapping and `llm-client.test.ts` pins
 * the refusals; what neither can see is whether the bytes actually survive the
 * whole route and land on the wire as `inlineData` — against the model's
 * DIRECT id, not its registry id. That is what this file is for, plus the
 * ordering property the feature rests on: an invalid payload dies before the
 * provider is ever called, so nothing is dispatched, billed or metered.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const generateContent = vi.fn()
const generateContentStream = vi.fn()
const safeFetch = vi.fn()

vi.mock("../../config.js", () => ({
  config: {
    GEMINI_API_KEY: "test-gemini-key",
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))
vi.mock("../../safe-fetch.js", () => ({ safeFetch }))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))

/** A minimal but real ISO-BMFF header: 24-byte `ftyp` box + padding. */
function mp4(payloadBytes = 32): Buffer {
  const ftyp = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "latin1"),
    Buffer.from("isomiso2mp41", "latin1"),
  ])
  return Buffer.concat([ftyp, Buffer.alloc(payloadBytes, 0x21)])
}
const CLIP = mp4().toString("base64")

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  generateContent.mockReset()
  generateContentStream.mockReset()
  safeFetch.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

describe("inline video bytes reach the direct Google lane intact", () => {
  it("sends inlineData + videoMetadata against the model's DIRECT id, fetching nothing", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    generateContent.mockResolvedValue({
      text: "analysis",
      usageMetadata: { promptTokenCount: 4210, candidatesTokenCount: 90 },
    })

    const res = await llmComplete({
      modelId: "gemini-3.1-pro",
      system: "you analyse clips",
      messages: [{
        role: "user",
        content: [
          { type: "video_base64", mediaType: "video/mp4", data: CLIP, fps: 2 },
          { type: "text", text: "what happens in this clip?" },
        ],
      }],
      requireLane: "direct",
    })

    expect(res.text).toBe("analysis")
    expect(generateContent).toHaveBeenCalledTimes(1)

    const sent = generateContent.mock.calls[0]![0] as {
      model: string
      contents: Array<{ role: string; parts: unknown[] }>
    }
    // Direct-lane semantics: Google's own id for the model (which carries a
    // `-preview` suffix), never the registry id we route by.
    expect(sent.model).toBe("gemini-3.1-pro-preview")
    expect(sent.contents).toHaveLength(1)
    expect(sent.contents[0]!.role).toBe("user")
    expect(sent.contents[0]!.parts).toEqual([
      // Bytes verbatim — the caller pinned this exact payload as the request's
      // identity, so anything but a byte-for-byte match is a different request.
      { inlineData: { mimeType: "video/mp4", data: CLIP }, videoMetadata: { fps: 2 } },
      { text: "what happens in this clip?" },
    ])

    // No dereference of anything: not our SSRF-safe fetcher, not raw fetch.
    expect(safeFetch).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("streams the same shape", async () => {
    const { llmStream } = await import("../../llm-client.js")
    generateContentStream.mockResolvedValue((async function* () {
      yield { text: "chunk", usageMetadata: { promptTokenCount: 4210, candidatesTokenCount: 1 } }
    })())

    const chunks: string[] = []
    await llmStream(
      {
        modelId: "gemini-3.1-pro",
        system: "",
        messages: [{ role: "user", content: [{ type: "video_base64", mediaType: "video/mp4", data: CLIP }] }],
        requireLane: "direct",
      },
      (c) => chunks.push(c),
    )

    expect(chunks).toEqual(["chunk"])
    const sent = generateContentStream.mock.calls[0]![0] as { contents: Array<{ parts: unknown[] }> }
    expect(sent.contents[0]!.parts).toEqual([{ inlineData: { mimeType: "video/mp4", data: CLIP } }])
    expect(safeFetch).not.toHaveBeenCalled()
  })

  // The ordering the whole feature rests on: validation is upstream of the
  // provider call, so a bad payload costs a throw — not a request, not a
  // billed prompt, not a metered usage row.
  it.each([
    ["non-canonical base64", { data: `${CLIP}\n`, match: /canonical base64/ }],
    ["a non-MP4 payload", { data: Buffer.from("RIFFxxxxWEBP").toString("base64"), match: /not an MP4/ }],
  ])("rejects %s without calling the provider", async (_label, { data, match }) => {
    const { llmComplete } = await import("../../llm-client.js")

    await expect(
      llmComplete({
        modelId: "gemini-3.1-pro",
        system: "",
        messages: [{ role: "user", content: [{ type: "video_base64", mediaType: "video/mp4", data }] }],
        requireLane: "direct",
      }),
    ).rejects.toThrow(match)

    expect(generateContent).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects an out-of-range fps without calling the provider", async () => {
    const { llmComplete } = await import("../../llm-client.js")

    await expect(
      llmComplete({
        modelId: "gemini-3.1-pro",
        system: "",
        messages: [{ role: "user", content: [{ type: "video_base64", mediaType: "video/mp4", data: CLIP, fps: 30 }] }],
        requireLane: "direct",
      }),
    ).rejects.toThrow(/fps must be in \(0, 24\]/)

    expect(generateContent).not.toHaveBeenCalled()
  })
})
