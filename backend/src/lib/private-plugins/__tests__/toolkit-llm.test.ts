/**
 * Guard: the toolkit's two LLM adapters must FORWARD every tuning field the
 * plugin contract exposes.
 *
 * History (2026-07-27): `PluginLlmMultimodalRequest` grew `temperature`/`topP`
 * but never `reasoningEffort`, while its text-only sibling had carried one all
 * along. The omission was invisible — no type error, no runtime error, just
 * every video-analysis roll silently riding the vendor default, at a
 * measurable cost to recall.
 *
 * The failure mode is a field that EXISTS on the contract and is DROPPED by the
 * adapter, so these tests assert the forwarded object key-by-key rather than
 * just checking the call happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockStructured } = vi.hoisted(() => ({
  mockStructured: vi.fn().mockResolvedValue({ output: { ok: true }, providerCost: 0.01 }),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("../../llm-client.js", () => ({ llmCompleteStructured: mockStructured }))

import { buildToolkit } from "../toolkit.js"

/** Fields a caller can tune that MUST survive the adapter, per lane. */
const TUNING_FIELDS = ["maxTokens", "temperature", "topP", "reasoningEffort"] as const

describe("toolkit.llm forwards every tuning field", () => {
  beforeEach(() => mockStructured.mockClear())

  it("completeStructuredMultimodal forwards sampling AND reasoning depth", async () => {
    const tk = buildToolkit()
    await tk.llm.completeStructuredMultimodal(
      {
        model: "gemini-3.6-flash",
        system: "sys",
        messages: [{ role: "user", content: [{ type: "video", url: "https://x/y.mp4" }, { type: "text", text: "t" }] }],
        maxTokens: 32768,
        temperature: 0.5,
        topP: 1,
        reasoningEffort: "high",
        timeoutMs: 300_000,
      },
      {},
    )

    expect(mockStructured).toHaveBeenCalledTimes(1)
    const sent = mockStructured.mock.calls[0]![0] as Record<string, unknown>
    expect(sent).toMatchObject({
      modelId: "gemini-3.6-flash",
      maxTokens: 32768,
      temperature: 0.5,
      topP: 1,
      reasoningEffort: "high",
      timeoutMs: 300_000,
    })
    // Explicit per-field presence check: `toMatchObject` would pass on a
    // silently-dropped key only if it were also absent from the expectation.
    for (const f of TUNING_FIELDS) {
      expect(sent[f], `${f} was dropped by the multimodal adapter`).toBeDefined()
    }
  })

  it("completeStructured (text) still forwards the same set", async () => {
    const tk = buildToolkit()
    await tk.llm.completeStructured(
      { model: "gpt-5.6-terra", system: "sys", prompt: "p", maxTokens: 4096, temperature: 0, topP: 1, reasoningEffort: "high" },
      {},
    )
    const sent = mockStructured.mock.calls[0]![0] as Record<string, unknown>
    for (const f of TUNING_FIELDS) {
      expect(sent[f], `${f} was dropped by the text adapter`).toBeDefined()
    }
    // temperature 0 is a deliberate pin (deterministic judge) — it must survive
    // the adapter, not be treated as absent by a truthiness check.
    expect(sent.temperature).toBe(0)
  })

  // The same failure class one level down: a tuning field on the CONTENT BLOCK
  // rather than on the request. `messages` currently passes by reference, so fps
  // rides through for free — this test is what fails if a per-block mapping
  // layer is ever introduced and forgets it, which would silently return every
  // analysis at Gemini's 1 fps default.
  it("forwards a video block's fps sampling rate untouched", async () => {
    const tk = buildToolkit()
    await tk.llm.completeStructuredMultimodal(
      {
        model: "gemini-3.1-pro",
        messages: [{ role: "user", content: [{ type: "video", url: "https://x/y.mp4", fps: 3 }, { type: "text", text: "t" }] }],
      },
      {},
    )
    const sent = mockStructured.mock.calls[0]![0] as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    expect(sent.messages[0]!.content[0], "fps was dropped between contract and llm-client").toEqual({
      type: "video",
      url: "https://x/y.mp4",
      fps: 3,
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Lane pinning. Video-analysis is direct-only BY CONSTRUCTION: the aggregator
  // reaches Gemini by smuggling media URLs through an `image_url` field rather
  // than sending real media parts, and drops record-shaped schema fields — so a
  // run served by KIE returns differently-grounded analysis with nothing to
  // signal it. The pin lives in this adapter's DEFAULT, which means deleting one
  // `?? "direct"` silently moves every analysis onto the wrong lane with no type
  // error and no runtime error. These are the tests that fail instead.
  // ─────────────────────────────────────────────────────────────────────────

  it("multimodal defaults to the direct lane — the video-analysis invariant", async () => {
    const tk = buildToolkit()
    await tk.llm.completeStructuredMultimodal(
      { model: "gemini-3.6-flash", messages: [{ role: "user", content: [{ type: "video", url: "https://x/y.mp4" }] }] },
      {},
    )
    const sent = mockStructured.mock.calls[0]![0] as Record<string, unknown>
    expect(sent.requireLane, "multimodal calls must pin the direct lane by default").toBe("direct")
  })

  it("an explicit lane still wins over the default", async () => {
    // The default is a default, not a hard-code: a caller that genuinely wants
    // the aggregator can still say so.
    const tk = buildToolkit()
    await tk.llm.completeStructuredMultimodal(
      {
        model: "gemini-3.6-flash",
        requireLane: "kie",
        messages: [{ role: "user", content: [{ type: "text", text: "t" }] }],
      },
      {},
    )
    const sent = mockStructured.mock.calls[0]![0] as Record<string, unknown>
    expect(sent.requireLane).toBe("kie")
  })

  it("the TEXT adapter does NOT pin — it must stay opt-in", async () => {
    // Deliberate asymmetry: text-only calls (gvp/evp planners, film-studio
    // doctrine, the video-analysis grader on a non-Gemini model) have no media
    // to lose and must keep their registry routing. Pinning them would hard-fail
    // every non-Gemini model at `assertLanePinnable`.
    const tk = buildToolkit()
    await tk.llm.completeStructured({ model: "gpt-5.6-terra", prompt: "p" }, {})
    const sent = mockStructured.mock.calls[0]![0] as Record<string, unknown>
    expect(sent.requireLane).toBeUndefined()
  })

  it("omitted fields stay undefined (vendor default), not coerced", async () => {
    const tk = buildToolkit()
    await tk.llm.completeStructuredMultimodal(
      { model: "gemini-3.6-flash", messages: [{ role: "user", content: [{ type: "text", text: "t" }] }] },
      {},
    )
    const sent = mockStructured.mock.calls[0]![0] as Record<string, unknown>
    expect(sent.reasoningEffort).toBeUndefined()
    expect(sent.temperature).toBeUndefined()
  })
})
