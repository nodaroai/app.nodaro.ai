/**
 * Payload-builder tests for the `video-analysis` node type.
 *
 * This node prices by video-duration bucket, and the duration is a
 * client-writable billing input — so the orchestrated (workflow-run) path MUST
 * derive the reserved credit id from the SAME 3-step resolution the route uses
 * (spec §Pricing, D5), never from a stale/forged panel value:
 *
 *   1. resolvedInputs.videoDuration      — upstream video metadata (trusted)
 *   2. data.probedYoutube.durationSec    — ONLY when the probe is URL-bound to
 *                                          the effective youtubeUrl (exact match)
 *   3. unknown → `<model>:600s` ceiling  — the only silent-ceiling path
 *
 * Plus the videoUrl-wins precedence (a wired/config videoUrl nulls youtubeUrl in
 * the payload, mirroring the route's single-source-of-truth rule).
 *
 * If `case "video-analysis"` is missing from payload-builder, buildPayload throws
 * "Unknown node type" and every run_workflow / app / trigger execution of this
 * node dies (the parameter-picker outage class). The registry-walk CI guard
 * pairs with these behavioural assertions.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

const jobId = "job-va-1"
const usageLogId = "usage-va-1"

function node(data: Record<string, unknown> = {}): SimpleNode {
  return { id: "va-node", type: "video-analysis", data }
}

const YT = "https://youtu.be/abc123"

describe("buildPayload — video-analysis", () => {
  it("does not throw 'Unknown node type' and returns the correct queue + job name", () => {
    const n = node({ youtubeUrl: YT })
    expect(() => buildPayload(n, jobId, {}, usageLogId)).not.toThrow()
    const result = buildPayload(n, jobId, {}, usageLogId)
    expect(result.queueName).toBe("video-generation")
    expect(result.jobName).toBe("video-analysis")
  })

  it("(a) unknown duration → <model>:600s ceiling composite", () => {
    // youtubeUrl but no probe, no upstream duration → ceiling.
    const result = buildPayload(node({ youtubeUrl: YT }), jobId, {}, usageLogId)
    expect(result.modelIdentifier).toBe("video-analysis:gemini-3-flash:600s")
    expect(result.payload.reservedCreditId).toBe("video-analysis:gemini-3-flash:600s")
    // Default model when data.llmModel is absent.
    expect(result.payload.llmModel).toBe("gemini-3-flash")
  })

  it("(a') respects an explicit llmModel in the ceiling composite", () => {
    const result = buildPayload(
      node({ youtubeUrl: YT, llmModel: "gemini-3.1-pro" }),
      jobId,
      {},
      usageLogId,
    )
    expect(result.modelIdentifier).toBe("video-analysis:gemini-3.1-pro:600s")
    expect(result.payload.llmModel).toBe("gemini-3.1-pro")
  })

  it("(b) URL-bound probedYoutube → bucketed composite when url === youtubeUrl", () => {
    const result = buildPayload(
      node({ youtubeUrl: YT, probedYoutube: { url: YT, durationSec: 170 } }),
      jobId,
      {},
      usageLogId,
    )
    // 170s → 180s bucket.
    expect(result.modelIdentifier).toBe("video-analysis:gemini-3-flash:180s")
    expect(result.payload.reservedCreditId).toBe("video-analysis:gemini-3-flash:180s")
    expect(result.payload.youtubeUrl).toBe(YT)
  })

  it("(c) IGNORES probedYoutube when its url does NOT match youtubeUrl → ceiling", () => {
    // Panel changed youtubeUrl but the stale probe still carries the old url +
    // its duration. The exact-url gate must reject it and fall to the ceiling.
    const result = buildPayload(
      node({
        youtubeUrl: "https://youtu.be/NEW999",
        probedYoutube: { url: YT, durationSec: 170 },
      }),
      jobId,
      {},
      usageLogId,
    )
    expect(result.modelIdentifier).toBe("video-analysis:gemini-3-flash:600s")
  })

  it("(d) resolvedInputs.videoDuration wins over probedYoutube", () => {
    // youtubeUrl + matching probe would resolve 500s (→600s), but a trusted
    // upstream videoDuration of 50s (→60s) must take precedence.
    const inputs: ResolvedInputs = { videoDuration: 50 }
    const result = buildPayload(
      node({ youtubeUrl: YT, probedYoutube: { url: YT, durationSec: 500 } }),
      jobId,
      inputs,
      usageLogId,
    )
    expect(result.modelIdentifier).toBe("video-analysis:gemini-3-flash:60s")
    expect(result.payload.reservedCreditId).toBe("video-analysis:gemini-3-flash:60s")
  })

  it("(e) videoUrl presence nulls youtubeUrl in the payload", () => {
    // Wired/config videoUrl wins — youtubeUrl must be undefined downstream so the
    // worker never treats a stale youtubeUrl as the source.
    const inputs: ResolvedInputs = { videoUrl: "https://cdn.example.com/clip.mp4", videoDuration: 50 }
    const result = buildPayload(
      node({ youtubeUrl: YT, probedYoutube: { url: YT, durationSec: 500 } }),
      jobId,
      inputs,
      usageLogId,
    )
    expect(result.payload.videoUrl).toBe("https://cdn.example.com/clip.mp4")
    expect(result.payload.youtubeUrl).toBeUndefined()
    // videoUrl carries no youtube pairing; duration comes from the trusted
    // upstream metadata (50s → 60s).
    expect(result.modelIdentifier).toBe("video-analysis:gemini-3-flash:60s")
  })

  it("forwards jobId, analysisFocus, nodeId and usageLogId in the payload", () => {
    const result = buildPayload(
      node({ youtubeUrl: YT, analysisFocus: "Focus on the camera moves." }),
      jobId,
      {},
      usageLogId,
    )
    expect(result.payload.jobId).toBe(jobId)
    expect(result.payload.usageLogId).toBe(usageLogId)
    expect(result.payload.analysisFocus).toBe("Focus on the camera moves.")
    expect(result.payload.nodeId).toBe("va-node")
  })
})
