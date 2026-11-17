import { describe, expect, it, vi } from "vitest"
import { createFalClient } from "@fal-ai/client"

vi.mock("@/lib/config.js", () => ({ config: { FAL_KEY: "test-fal-key" } }))

import { FalSubmitAmbiguousError, markSubmitOnce, submitOnceFetch } from "../client.js"
import { FAL_GEMINI_OMNI_EXTEND_ENDPOINT } from "../gemini-omni-extend.js"

// Decided 2026-11-17: against the SDK itself (not a stand-in). Its queue client
// re-sends a submit after a 502 / 503 / 504 or a network failure; with the
// send-once transport it sends the submit of a marked endpoint exactly once.
describe("the fal SDK with the send-once transport", () => {
  const sdk = (inner: typeof fetch) => createFalClient({ credentials: "test-fal-key", fetch: submitOnceFetch(inner) })

  it("sends Gemini Omni Flash 1.2 Extend's submit once after a 502, and fails with the unknown-outcome error", async () => {
    markSubmitOnce(FAL_GEMINI_OMNI_EXTEND_ENDPOINT)
    const inner = vi.fn(async () => new Response("bad gateway", { status: 502 }))
    const err = await sdk(inner as never).queue.submit(FAL_GEMINI_OMNI_EXTEND_ENDPOINT, { input: { prompt: "x" } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FalSubmitAmbiguousError)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("sends it once after a network failure too", async () => {
    markSubmitOnce(FAL_GEMINI_OMNI_EXTEND_ENDPOINT)
    const inner = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) })
    })
    const err = await sdk(inner as never).queue.submit(FAL_GEMINI_OMNI_EXTEND_ENDPOINT, { input: { prompt: "x" } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FalSubmitAmbiguousError)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("a successful submit answers its request id as before", async () => {
    markSubmitOnce(FAL_GEMINI_OMNI_EXTEND_ENDPOINT)
    const inner = vi.fn(async () => new Response(JSON.stringify({ request_id: "req-1" }), { status: 200, headers: { "content-type": "application/json" } }))
    const out = await sdk(inner as never).queue.submit(FAL_GEMINI_OMNI_EXTEND_ENDPOINT, { input: { prompt: "x" } })
    expect((out as { request_id: string }).request_id).toBe("req-1")
    expect(inner).toHaveBeenCalledTimes(1)
  })
})
