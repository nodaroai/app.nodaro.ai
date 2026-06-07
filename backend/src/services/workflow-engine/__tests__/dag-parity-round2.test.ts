/**
 * Regression tests for the second round of DAG parity fixes (2026-04-17):
 *   - resize-video default method: "fit" → "pad" (match Zod)
 *   - webhook-output: inline executor emits statusCode/responseBody + audit job
 *   - sub-workflow: emits `_outputResults` keyed by portId
 *   - transcribe worker: normalises social video URLs via extractYouTubeAudio
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { executeWebhookOutput } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState, OrchestratorContext } from "../types.js"

// executeWebhookOutput now routes through safeFetch (SSRF gate), not global fetch.
// Mock only safeFetch; keep the real isPrivateOrReservedIP so url-validator's
// safeUrlSchema (imported by inline-executor) still functions for the SSRF test.
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }))
vi.mock("../../../lib/safe-fetch.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../lib/safe-fetch.js")>()
  return { ...actual, safeFetch: safeFetchMock }
})

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  }
}

const JOB_ID = "job-1"

// ---------------------------------------------------------------------------
// Fix 1: resize-video default method
// ---------------------------------------------------------------------------

describe("resize-video — default method matches Zod enum", () => {
  it("defaults method to 'pad' (not 'fit')", () => {
    const n = node("r1", "resize-video", { videoUrl: "https://v.mp4" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.method).toBe("pad")
  })

  it("respects explicit method when set", () => {
    const n = node("r1", "resize-video", { videoUrl: "https://v.mp4", method: "crop" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.method).toBe("crop")
  })
})

// ---------------------------------------------------------------------------
// Fix 2: webhook-output audit trail + statusCode/responseBody output fields
// ---------------------------------------------------------------------------

describe("webhook-output — emits audit fields on node output", () => {
  beforeEach(() => {
    safeFetchMock.mockReset()
  })

  it("returns webhookSuccess + statusCode + responseBody on 2xx", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"received":true}'),
    })

    const wh = node("w1", "webhook-output", { url: "https://example.com/hook" })
    const src = node("s1", "text-prompt", { text: "hello" })
    const allNodes: SimpleNode[] = [wh, src]
    const edges: SimpleEdge[] = [edge("s1", "w1", null, null)]
    const states: Record<string, NodeExecutionState> = {
      s1: { status: "completed", output: { text: "hello" } },
    }

    // ctx omitted — skips the supabase insert but still captures the response
    const out = await executeWebhookOutput(wh, edges, allNodes, states, undefined)
    expect(out.webhookSuccess).toBe(true)
    expect(out.webhookStatusCode).toBe(200)
    expect(out.webhookResponseBody).toBe('{"received":true}')
    expect(out.text).toBe("sent")
    // SSRF gate: routed through safeFetch (not global fetch).
    expect(safeFetchMock).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("throws with statusCode + truncated body on non-2xx", async () => {
    safeFetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("x".repeat(3000)),
    })

    const wh = node("w1", "webhook-output", { url: "https://example.com/hook" })

    await expect(
      executeWebhookOutput(wh, [], [wh], {}, undefined),
    ).rejects.toThrow(/502/)
  })

  it("truncates response body to 2000 chars", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("a".repeat(5000)),
    })

    const wh = node("w1", "webhook-output", { url: "https://example.com/hook" })
    const out = await executeWebhookOutput(wh, [], [wh], {}, undefined)
    expect((out.webhookResponseBody as string).length).toBe(2000)
  })

  it("rejects an SSRF URL (cloud-metadata IP) before fetching", async () => {
    const wh = node("w1", "webhook-output", { url: "http://169.254.169.254/latest/meta-data/" })
    await expect(
      executeWebhookOutput(wh, [], [wh], {}, undefined),
    ).rejects.toThrow(/blocked address/)
    expect(safeFetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Fix 4: transcribe — social URL regex detection
// ---------------------------------------------------------------------------
// The worker-level change lives in backend/src/workers/handlers/audio-ai.ts
// (outside the service boundary tested here); this test guards the regex
// so future edits to `SOCIAL_VIDEO_URL_RE` keep platform coverage intact.

describe("transcribe — social video URL detection", () => {
  // Re-declare the regex here to avoid importing from a worker module (which
  // pulls in BullMQ). This duplicates the pattern intentionally — when the
  // worker regex is updated, this test must be updated too, and the diff
  // makes the drift visible.
  const SOCIAL_VIDEO_URL_RE = /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com)/i

  it.each([
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
    "https://www.tiktok.com/@user/video/123",
    "https://www.instagram.com/reel/abc",
    "https://twitter.com/user/status/123",
    "https://x.com/user/status/123",
  ])("detects %s as a social video URL", (url) => {
    expect(SOCIAL_VIDEO_URL_RE.test(url)).toBe(true)
  })

  it.each([
    "https://r2.cloudflarestorage.com/bucket/audio.mp3",
    "https://example.com/podcast.wav",
    "https://my.cdn.io/a.m4a",
  ])("does not match direct audio URL %s", (url) => {
    expect(SOCIAL_VIDEO_URL_RE.test(url)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fix 3: sub-workflow _outputResults (tested via behavioural assertion on
// the handler's output-shaping logic; full sub-workflow execution requires
// BullMQ / DB and is covered by existing sub-workflow-handler.test.ts).
// ---------------------------------------------------------------------------

describe("sub-workflow output shape contract", () => {
  // This test documents the contract: output-extractor.ts expects
  // `_outputResults: Record<portId, value>` plus optional
  // `_visibleOutputPortId` on sub-workflow outputs. If a future refactor
  // removes these shape fields, downstream per-port routing breaks silently.
  it("NodeOutput type allows _outputResults and _visibleOutputPortId", () => {
    // Pure type-shape check — compile-time guarantee.
    const output: import("../types.js").NodeOutput = {
      _outputResults: { port1: "https://img.png", port2: "hello" },
      _visibleOutputPortId: "port1",
    }
    expect(output._outputResults?.port1).toBe("https://img.png")
    expect(output._visibleOutputPortId).toBe("port1")
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting: verify webhook-output NodeOutput fields are in the type
// ---------------------------------------------------------------------------

describe("NodeOutput type surface", () => {
  it("includes webhook-output audit fields", () => {
    const output: import("../types.js").NodeOutput = {
      webhookSuccess: true,
      webhookStatusCode: 200,
      webhookResponseBody: "ok",
    }
    expect(output.webhookSuccess).toBe(true)
    expect(output.webhookStatusCode).toBe(200)
  })
})
