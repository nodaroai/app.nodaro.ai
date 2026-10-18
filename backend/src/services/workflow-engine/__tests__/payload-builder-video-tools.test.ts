/**
 * buildPayload: the video tool nodes (video analysis, video audit, video
 * depth, video mask, smart-cut windows).
 *
 * Merged from 5 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 5 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect } from "vitest"
import { buildPayload, videoAuditAnalysisWired } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs, SimpleEdge } from "../types.js"
import { VIDEO_AUDIT_BUCKET_CREDITS } from "@nodaro/shared/credits"
import { SMART_CUT_WINDOW_MAX, SMART_CUT_WINDOW_MIN } from "@nodaro/shared/edl"

describe("payload-builder-video-analysis.test.ts", () => {
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
      expect(result.modelIdentifier).toBe("video-analysis:gemini-3.1-pro:600s")
      expect(result.payload.reservedCreditId).toBe("video-analysis:gemini-3.1-pro:600s")
      // Default model when data.llmModel is absent.
      expect(result.payload.llmModel).toBe("gemini-3.1-pro")
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
      expect(result.modelIdentifier).toBe("video-analysis:gemini-3.1-pro:180s")
      expect(result.payload.reservedCreditId).toBe("video-analysis:gemini-3.1-pro:180s")
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
      expect(result.modelIdentifier).toBe("video-analysis:gemini-3.1-pro:600s")
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
      expect(result.modelIdentifier).toBe("video-analysis:gemini-3.1-pro:60s")
      expect(result.payload.reservedCreditId).toBe("video-analysis:gemini-3.1-pro:60s")
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
      expect(result.modelIdentifier).toBe("video-analysis:gemini-3.1-pro:60s")
    })

    it("(f) a post's link wired into the video handle is analyzed before the node's own link", () => {
      const wired = "https://youtu.be/WIRED42"
      const result = buildPayload(node({ youtubeUrl: YT }), jobId, { videoPageUrl: wired }, usageLogId)
      expect(result.payload.youtubeUrl).toBe(wired)
      expect(result.payload.videoUrl).toBeUndefined()
    })

    it("(g) a wired video file still wins over a wired link", () => {
      const inputs: ResolvedInputs = { videoUrl: "https://cdn.example.com/clip.mp4", videoPageUrl: "https://youtu.be/WIRED42" }
      const result = buildPayload(node({ youtubeUrl: YT }), jobId, inputs, usageLogId)
      expect(result.payload.videoUrl).toBe("https://cdn.example.com/clip.mp4")
      expect(result.payload.youtubeUrl).toBeUndefined()
    })

    it("(h) the editor's read of the TYPED link never prices a different wired link", () => {
      const result = buildPayload(
        node({ youtubeUrl: YT, probedYoutube: { url: YT, durationSec: 170 } }),
        jobId,
        { videoPageUrl: "https://youtu.be/WIRED42" },
        usageLogId,
      )
      expect(result.modelIdentifier).toBe("video-analysis:gemini-3.1-pro:600s")
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

    it("mixed tiers: sentinel rides the payload, credit id prices under the shared mixed family", () => {
      for (const tier of ["mixed", "mixed-fast"] as const) {
        const result = buildPayload(
          node({ youtubeUrl: YT, llmModel: tier, probedYoutube: { url: YT, durationSec: 170 } }),
          jobId,
          {},
          usageLogId,
        )
        // BOTH variants price under the ONE mixed family (identical compute)…
        expect(result.modelIdentifier).toBe("video-analysis:mixed:180s")
        expect(result.payload.reservedCreditId).toBe("video-analysis:mixed:180s")
        // …but the payload carries the DISTINCT sentinel — the analysis engine
        // expands it to the roll plan and judge scope.
        expect(result.payload.llmModel).toBe(tier)
      }
    })

    it("forwards selectionMode 'combine'; fail-safe narrows anything else to undefined (choose)", () => {
      const combine = buildPayload(node({ youtubeUrl: YT, selectionMode: "combine" }), jobId, {}, usageLogId)
      expect(combine.payload.selectionMode).toBe("combine")

      // Absent → undefined (worker defaults to choose).
      const absent = buildPayload(node({ youtubeUrl: YT }), jobId, {}, usageLogId)
      expect(absent.payload.selectionMode).toBeUndefined()

      // Forged/unknown value → undefined, never passed through verbatim.
      const forged = buildPayload(node({ youtubeUrl: YT, selectionMode: "merge-everything" }), jobId, {}, usageLogId)
      expect(forged.payload.selectionMode).toBeUndefined()
    })

    it("forwards each language lever only for a literal true, and keeps them independent", () => {
      // The levers must not be coupled anywhere on the path: an English-narration
      // run over untouched foreign signage is exactly why they are two fields.
      const speech = buildPayload(node({ youtubeUrl: YT, translateSpeechToEnglish: true }), jobId, {}, usageLogId)
      expect(speech.payload.translateSpeechToEnglish).toBe(true)
      expect(speech.payload.translateOnScreenTextToEnglish).toBeUndefined()

      const onScreen = buildPayload(node({ youtubeUrl: YT, translateOnScreenTextToEnglish: true }), jobId, {}, usageLogId)
      expect(onScreen.payload.translateSpeechToEnglish).toBeUndefined()
      expect(onScreen.payload.translateOnScreenTextToEnglish).toBe(true)

      const both = buildPayload(
        node({ youtubeUrl: YT, translateSpeechToEnglish: true, translateOnScreenTextToEnglish: true }),
        jobId,
        {},
        usageLogId,
      )
      expect(both.payload.translateSpeechToEnglish).toBe(true)
      expect(both.payload.translateOnScreenTextToEnglish).toBe(true)
    })

    it("omits both levers when absent, false, or forged (keep original language)", () => {
      // Absent → undefined. This is the default path, and both must stay absent
      // from the payload entirely: the plugin reads "missing" as "keep the
      // footage's language", which is the historical behavior.
      const absent = buildPayload(node({ youtubeUrl: YT }), jobId, {}, usageLogId)
      expect(absent.payload.translateSpeechToEnglish).toBeUndefined()
      expect(absent.payload.translateOnScreenTextToEnglish).toBeUndefined()

      // Explicit false is the same as absent — never send `false` on the wire.
      const off = buildPayload(
        node({ youtubeUrl: YT, translateSpeechToEnglish: false, translateOnScreenTextToEnglish: false }),
        jobId,
        {},
        usageLogId,
      )
      expect(off.payload.translateSpeechToEnglish).toBeUndefined()
      expect(off.payload.translateOnScreenTextToEnglish).toBeUndefined()

      // Truthy-but-not-true values in saved node data must NOT flip a run into
      // English — a stale string from an older/hand-edited workflow is not consent.
      for (const forged of ["true", 1, "yes", {}]) {
        const r = buildPayload(
          node({ youtubeUrl: YT, translateSpeechToEnglish: forged, translateOnScreenTextToEnglish: forged }),
          jobId,
          {},
          usageLogId,
        )
        expect(r.payload.translateSpeechToEnglish).toBeUndefined()
        expect(r.payload.translateOnScreenTextToEnglish).toBeUndefined()
      }
    })
  })
})

describe("payload-builder-video-audit.test.ts", () => {
  /**
   * Payload-builder tests for the `video-audit` node type ("AI Audit").
   *
   * Sibling of `payload-builder-video-analysis.test.ts`. Without a
   * `case "video-audit"` in payload-builder, buildPayload throws "Unknown node
   * type" and EVERY non-canvas execution path (webhook triggers, schedules,
   * published apps, MCP run_workflow, sub-workflows) creates a stale `pending`
   * jobs row and then kills the whole workflow — the parameter-picker outage
   * class. The registry-walk CI guard pairs with these behavioural assertions.
   *
   * The node prices off TWO axes, and both are derived here rather than trusted
   * from the panel:
   *
   *   FAMILY   — `video-audit:*` when an analysis was PROVIDED (the audit only
   *              re-watches against it) vs `video-audit:auto:*` when none was
   *              (the node runs its own fast analysis first, hence the pricier
   *              family). The frontend picks the family from the EDGES
   *              (`videoAuditAnalysisWired`); the server picks it from whether
   *              the analysis actually RESOLVED, and refuses to run when those
   *              two disagree — otherwise a server run would silently bill a
   *              family the canvas never quoted.
   *   DURATION — the same bucket ladder as video-analysis (60/180/360/600s),
   *              resolved from trusted upstream metadata, else the node's
   *              URL-BOUND probe, else the 600s ceiling (over-reserves, never
   *              under).
   */
  const jobId = "job-vaud-1"
  const usageLogId = "usage-vaud-1"

  const CLIP = "https://cdn.example.com/clip.mp4"

  /** A minimal stand-in for the wired analysis — buildPayload never inspects its
   *  shape (it forwards it verbatim to the plugin, which parses it), so the test
   *  only needs an identifiable object to assert pass-through on. */
  const ANALYSIS = { meta: { durationSec: 12 }, slots: [], scenes: [{ sceneNumber: 1 }] }

  function node(data: Record<string, unknown> = {}): SimpleNode {
    return { id: "vaud-node", type: "video-audit", data: { videoUrl: CLIP, ...data } }
  }

  /** An edge into the node's `analysis` target — what the canvas prices from. */
  const ANALYSIS_EDGE: SimpleEdge[] = [
    { id: "e1", source: "va", target: "vaud-node", sourceHandle: "json", targetHandle: "analysis" } as SimpleEdge,
  ]
  /** A video-only wiring — no analysis edge, so the auto family is correct. */
  const VIDEO_EDGE: SimpleEdge[] = [
    { id: "e2", source: "up", target: "vaud-node", sourceHandle: "video", targetHandle: "video" } as SimpleEdge,
  ]

  describe("buildPayload — video-audit", () => {
    it("does not throw 'Unknown node type' and returns the correct queue + job name", () => {
      expect(() => buildPayload(node(), jobId, {}, usageLogId)).not.toThrow()
      const result = buildPayload(node(), jobId, {}, usageLogId)
      expect(result.queueName).toBe("video-generation")
      expect(result.jobName).toBe("video-audit")
    })

    // ── FAMILY ────────────────────────────────────────────────────────────────

    it("(a) no analysis resolved → the AUTO family (the node analyses the clip itself)", () => {
      const result = buildPayload(node(), jobId, {}, usageLogId)
      expect(result.modelIdentifier).toBe("video-audit:auto:600s")
      expect(result.payload.reservedCreditId).toBe("video-audit:auto:600s")
      // `analysis` is OMITTED from the wire, never sent as an explicit undefined —
      // the plugin's family switch keys off presence.
      expect("analysis" in result.payload).toBe(false)
    })

    it("(b) analysis resolved → the RE-AUDIT family, and the payload carries it verbatim", () => {
      const inputs: ResolvedInputs = { analysis: ANALYSIS }
      const result = buildPayload(node(), jobId, inputs, usageLogId, {
        nodes: [], edges: ANALYSIS_EDGE, nodeStates: {},
      })
      expect(result.modelIdentifier).toBe("video-audit:600s")
      expect(result.payload.reservedCreditId).toBe("video-audit:600s")
      // Same object reference — no re-serialization, no normalization, no clone.
      expect(result.payload.analysis).toBe(ANALYSIS)
    })

    it("(b') the two families are DIFFERENT prices at the same bucket (the reason the rule exists)", () => {
      const wired = buildPayload(node(), jobId, { analysis: ANALYSIS }, usageLogId, {
        nodes: [], edges: ANALYSIS_EDGE, nodeStates: {},
      })
      const auto = buildPayload(node(), jobId, {}, usageLogId, { nodes: [], edges: VIDEO_EDGE, nodeStates: {} })
      const wiredCost = VIDEO_AUDIT_BUCKET_CREDITS[wired.modelIdentifier]
      const autoCost = VIDEO_AUDIT_BUCKET_CREDITS[auto.modelIdentifier]
      // Both ids must be real rows in the shared table (a typo'd family/bucket
      // would resolve to `undefined` and reserve nothing).
      expect(wiredCost).toBeGreaterThan(0)
      expect(autoCost).toBeGreaterThan(0)
      expect(autoCost).toBeGreaterThan(wiredCost)
    })

    it("(c) an analysis from a wired edge that produced NOTHING is refused, not silently up-priced", () => {
      // The canvas badge / workflow total / run-confirm dialog all quoted the
      // cheaper wired family from this same edge. Running would bill the auto
      // family instead — so refuse, exactly like the frontend executor does.
      expect(() =>
        buildPayload(node(), jobId, {}, usageLogId, { nodes: [], edges: ANALYSIS_EDGE, nodeStates: {} }),
      ).toThrow(/analysis_not_ready/)
    })

    it("(c') the refusal is scoped to the `analysis` handle — a video-only wiring runs auto", () => {
      const result = buildPayload(node(), jobId, {}, usageLogId, {
        nodes: [], edges: VIDEO_EDGE, nodeStates: {},
      })
      expect(result.modelIdentifier).toBe("video-audit:auto:600s")
    })

    // ── DURATION BUCKET ───────────────────────────────────────────────────────

    it("(d) resolvedInputs.videoDuration buckets BOTH families identically", () => {
      const auto = buildPayload(node(), jobId, { videoDuration: 170 }, usageLogId)
      expect(auto.modelIdentifier).toBe("video-audit:auto:180s")

      const wired = buildPayload(node(), jobId, { videoDuration: 170, analysis: ANALYSIS }, usageLogId, {
        nodes: [], edges: ANALYSIS_EDGE, nodeStates: {},
      })
      expect(wired.modelIdentifier).toBe("video-audit:180s")
    })

    it("(e) URL-bound probedVideo buckets the reserve when its url matches the effective videoUrl", () => {
      const result = buildPayload(
        node({ probedVideo: { url: CLIP, durationSec: 55 } }),
        jobId,
        {},
        usageLogId,
      )
      // 55s → 60s bucket.
      expect(result.modelIdentifier).toBe("video-audit:auto:60s")
    })

    it("(f) IGNORES a probedVideo whose url does NOT match the effective videoUrl → ceiling", () => {
      // The panel's clip changed but the stale probe still carries the old url +
      // its duration. The exact-url gate must reject it (over-reserve, never under).
      const result = buildPayload(
        node({ videoUrl: "https://cdn.example.com/OTHER.mp4", probedVideo: { url: CLIP, durationSec: 55 } }),
        jobId,
        {},
        usageLogId,
      )
      expect(result.modelIdentifier).toBe("video-audit:auto:600s")
    })

    it("(f') a WIRED videoUrl re-binds the probe check — a probe bound to the config url is stale", () => {
      const inputs: ResolvedInputs = { videoUrl: "https://cdn.example.com/wired.mp4" }
      const result = buildPayload(
        node({ probedVideo: { url: CLIP, durationSec: 55 } }),
        jobId,
        inputs,
        usageLogId,
      )
      expect(result.payload.videoUrl).toBe("https://cdn.example.com/wired.mp4")
      expect(result.modelIdentifier).toBe("video-audit:auto:600s")
    })

    it("(g) trusted upstream videoDuration wins over a matching probedVideo", () => {
      const result = buildPayload(
        node({ probedVideo: { url: CLIP, durationSec: 500 } }),
        jobId,
        { videoDuration: 50 },
        usageLogId,
      )
      expect(result.modelIdentifier).toBe("video-audit:auto:60s")
    })

    it("(h) every family × bucket combination resolves to a real row in the shared table", () => {
      // 64 s: the first whole second past the 60s bucket and its 3-second pricing
      // grace (VIDEO_ANALYSIS_BUCKET_GRACE_SEC) — a 61 s clip now prices as 60s.
      for (const [durationSec, bucket] of [[10, 60], [61, 60], [64, 180], [200, 360], [500, 600], [99999, 600]] as const) {
        for (const analysis of [ANALYSIS, undefined]) {
          const result = buildPayload(
            node(),
            jobId,
            { videoDuration: durationSec, ...(analysis ? { analysis } : {}) },
            usageLogId,
            { nodes: [], edges: analysis ? ANALYSIS_EDGE : [], nodeStates: {} },
          )
          const expected = `video-audit${analysis ? "" : ":auto"}:${bucket}s`
          expect(result.modelIdentifier).toBe(expected)
          expect(VIDEO_AUDIT_BUCKET_CREDITS[expected]).toBeGreaterThan(0)
        }
      }
    })

    // ── PAYLOAD SHAPE / GUARDS ────────────────────────────────────────────────

    it("modelIdentifier IS payload.reservedCreditId (one id reserves, commits and refunds)", () => {
      const result = buildPayload(node(), jobId, { videoDuration: 170 }, usageLogId)
      expect(result.payload.reservedCreditId).toBe(result.modelIdentifier)
    })

    it("forwards jobId, videoUrl, nodeId and usageLogId in the payload", () => {
      const result = buildPayload(node(), jobId, {}, usageLogId)
      expect(result.payload.jobId).toBe(jobId)
      expect(result.payload.videoUrl).toBe(CLIP)
      expect(result.payload.nodeId).toBe("vaud-node")
      expect(result.payload.usageLogId).toBe(usageLogId)
    })

    it("a wired videoUrl wins over the config field", () => {
      const result = buildPayload(node(), jobId, { videoUrl: "https://cdn.example.com/wired.mp4" }, usageLogId)
      expect(result.payload.videoUrl).toBe("https://cdn.example.com/wired.mp4")
    })

    it("throws (deleting the pending job, reserving nothing) when no clip is resolvable", () => {
      const bare: SimpleNode = { id: "vaud-node", type: "video-audit", data: {} }
      expect(() => buildPayload(bare, jobId, {}, usageLogId)).toThrow(/video_required/)
    })
  })

  describe("videoAuditAnalysisWired (backend mirror of the frontend family rule)", () => {
    it("true only for an edge into THIS node's `analysis` target", () => {
      expect(videoAuditAnalysisWired("vaud-node", ANALYSIS_EDGE)).toBe(true)
      expect(videoAuditAnalysisWired("vaud-node", VIDEO_EDGE)).toBe(false)
      expect(videoAuditAnalysisWired("vaud-node", [])).toBe(false)
      // An analysis edge into a DIFFERENT node is not this node's.
      expect(videoAuditAnalysisWired("other", ANALYSIS_EDGE)).toBe(false)
    })

    it("no graph context → false (never claims an analysis it can't see)", () => {
      expect(videoAuditAnalysisWired("vaud-node", undefined)).toBe(false)
      expect(videoAuditAnalysisWired(undefined, ANALYSIS_EDGE)).toBe(false)
    })
  })
})

describe("payload-builder-video-depth.test.ts", () => {
  /**
   * Payload-builder tests for the `video-depth` node type.
   *
   * Raw workflow JSON (imports, templates, MCP writes, FieldMappings) reaches
   * buildPayload without the route's Zod, so every enum the worker indexes is
   * coerced here rather than trusted: the provider (unknown → the default), the
   * model size (unknown → large) and the colormap (`resolveVideoDepthColormap`:
   * a colormap the provider cannot render → grayscale). Levers a provider does
   * not honour are dropped, never sent. The bucket price row is NOT picked here:
   * node-executor measures the clip and swaps it in (`stampVideoDepthInput`).
   */
  const CLIP = "https://cdn.example.com/clip.mp4"

  const node = (data: Record<string, unknown>): SimpleNode => ({ id: "vd-1", type: "video-depth", data })
  const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })
  const build = (data: Record<string, unknown>, resolved: { videoUrl?: string } = { videoUrl: CLIP }) => {
    const n = node(data)
    return buildPayload(n, "job-vd-1", resolved, "usage-vd-1", ctx(n))
  }

  describe("buildPayload — video-depth", () => {
    it("Replicate: keeps provider + size, coerces an unoffered colormap to grayscale, drops the fal-only levers", () => {
      const r = build({
        provider: "depth-anything-frames",
        modelSize: "small",
        colormap: "turbo",
        resolution: "720p",
        sideBySide: true,
        outputFps: 24,
      })
      expect(r.jobName).toBe("video-depth")
      expect(r.queueName).toBe("video-generation")
      expect(r.modelIdentifier).toBe("depth-anything-frames")
      expect(r.payload).toEqual({
        jobId: "job-vd-1",
        videoUrl: CLIP,
        provider: "depth-anything-frames",
        modelSize: "small",
        colormap: "grayscale",
        usageLogId: "usage-vd-1",
      })
    })

    it("Replicate keeps inferno, its other native colormap", () => {
      expect(build({ provider: "depth-anything-frames", colormap: "inferno" }).payload.colormap).toBe("inferno")
    })

    it("fal (the default when no provider is set): every lever passes, colormap as requested", () => {
      const r = build({ modelSize: "base", colormap: "turbo", resolution: "720p", sideBySide: true })
      expect(r.modelIdentifier).toBe("video-depth-anything")
      expect(r.payload).toMatchObject({
        provider: "video-depth-anything",
        modelSize: "base",
        colormap: "turbo",
        resolution: "720p",
        sideBySide: true,
      })
    })

    it("never sends a legacy outputFps a saved node still carries (the lever was removed)", () => {
      expect(build({ outputFps: 24 }).payload).not.toHaveProperty("outputFps")
    })

    it("fal with no levers set: grayscale, large, nothing optional sent", () => {
      const r = build({})
      expect(r.payload).toEqual({
        jobId: "job-vd-1",
        videoUrl: CLIP,
        provider: "video-depth-anything",
        modelSize: "large",
        colormap: "grayscale",
        usageLogId: "usage-vd-1",
      })
    })

    it("coerces an unknown provider to the default and an unknown model size to large", () => {
      const r = build({ provider: "nope", modelSize: "huge", colormap: "nope" })
      expect(r.modelIdentifier).toBe("video-depth-anything")
      expect(r.payload).toMatchObject({ provider: "video-depth-anything", modelSize: "large", colormap: "grayscale" })
    })

    it("drops fal lever values the route would reject (resolution outside the enum, a non-boolean side-by-side)", () => {
      for (const bad of [{ resolution: "4k" }, { sideBySide: "yes" }]) {
        const p = build(bad).payload
        expect(p.resolution, JSON.stringify(bad)).toBeUndefined()
        expect(p.sideBySide, JSON.stringify(bad)).toBeUndefined()
      }
    })

    it("falls back to the node's own videoUrl when nothing is wired", () => {
      expect(build({ videoUrl: "https://cdn.example.com/own.mp4" }, {}).payload.videoUrl).toBe("https://cdn.example.com/own.mp4")
    })

    it("refuses with video_required when no video is wired or set", () => {
      try {
        build({}, {})
        expect.unreachable("buildPayload should refuse a video-depth node with no video")
      } catch (e) {
        expect((e as { code?: string }).code).toBe("video_required")
      }
    })
  })
})

describe("payload-builder-video-mask.test.ts", () => {
  /**
   * Video Mask + Mask Composite payloads on the workflow lane. That lane never
   * meets the routes' Zod, so the builder applies their rules itself: a blank
   * prompt is refused before any reservation and the threshold is held to the
   * model's range; Mask Composite sends exactly the keys its media guard checks.
   */
  const JOB = "job-video-mask"
  const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })
  const node = (type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id: `${type}-1`, type, data: { label: "My Node", ...data } })
  const build = (n: SimpleNode, inputs: ResolvedInputs) => buildPayload(n, JOB, inputs, undefined, ctx(n)) as { jobName: string; modelIdentifier: string; payload: Record<string, unknown> }

  describe("video-mask payload", () => {
    it("sends the trimmed wired prompt over the node's, with the default threshold and model", () => {
      const r = build(node("video-mask", { prompt: "the cat" }), { videoUrl: "https://x/c.mp4", prompt: "  the dancer  " })
      expect(r.jobName).toBe("video-mask")
      expect(r.payload).toMatchObject({ videoUrl: "https://x/c.mp4", prompt: "the dancer", threshold: 0.5, provider: "sam-3.1" })
    })

    it("falls back to the node's own prompt when the wire is blank", () => {
      const r = build(node("video-mask", { prompt: "the cat" }), { videoUrl: "https://x/c.mp4", prompt: "   " })
      expect(r.payload.prompt).toBe("the cat")
    })

    it("refuses a run with no prompt anywhere (before any reservation, like the route's 400)", () => {
      expect(() => build(node("video-mask", { prompt: "  " }), { videoUrl: "https://x/c.mp4" })).toThrow(/no prompt/)
    })

    it("holds a threshold written straight into workflow JSON to the model's range", () => {
      expect(build(node("video-mask", { prompt: "x", threshold: 1 }), { videoUrl: "https://x/c.mp4" }).payload.threshold).toBe(0.95)
      expect(build(node("video-mask", { prompt: "x", threshold: 0 }), { videoUrl: "https://x/c.mp4" }).payload.threshold).toBe(0.05)
      expect(build(node("video-mask", { prompt: "x", threshold: "high" }), { videoUrl: "https://x/c.mp4" }).payload.threshold).toBe(0.5)
    })

    it("refuses a run with no video", () => {
      expect(() => build(node("video-mask", { prompt: "x" }), {})).toThrow()
    })
  })

  describe("mask-composite payload", () => {
    it("sends the three resolved videos and the normalised settings at the flat row", () => {
      const r = build(node("mask-composite", { feather: 50, audioSource: "mix" }), {
        videoUrl: "https://x/fg.mp4", backgroundVideoUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4",
      })
      expect(r.modelIdentifier).toBe("mask-composite")
      expect(r.payload).toMatchObject({
        foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4",
        invertMask: false, feather: 20, grow: 0, backgroundFit: "cover", audioSource: "mix",
      })
    })

    it("refuses a missing mask, and never passes a guard it then cannot honour", () => {
      expect(() => build(node("mask-composite"), { videoUrl: "https://x/fg.mp4", backgroundVideoUrl: "https://x/bg.mp4" })).toThrow()
      // A node carrying data.maskUrl passes the guard AND reaches the worker with it.
      const r = build(node("mask-composite", { maskUrl: "https://x/m.mp4" }), { videoUrl: "https://x/fg.mp4", backgroundVideoUrl: "https://x/bg.mp4" })
      expect(r.payload.maskUrl).toBe("https://x/m.mp4")
    })
  })
})

describe("payload-builder-smart-cut-windows.test.ts", () => {
  /**
   * `/v1/combine-videos` bounds `smartCutFramesPrev` / `smartCutFramesNext` with
   * the shared `SMART_CUT_WINDOW_MIN`/`MAX`, and REJECTS anything outside them.
   * A node's `data` is not a trusted source for those numbers: it can be typed
   * into the config panel, written straight into workflow JSON by an agent or an
   * import, or carried over from a template. So every send path clamps through
   * `clampSmartCutWindow` rather than forwarding the raw value — otherwise one
   * stale field 400s the whole workflow run at finalize time (production
   * app_reports, 2026-09-07: `smartCutFramesPrev` AND `smartCutFramesNext` both
   * "Too big: expected number to be <=24").
   */
  describe("combine-videos smart-cut search windows (orchestrator send path)", () => {
    const inputs: ResolvedInputs = { videoUrls: ["https://v1.mp4", "https://v2.mp4"] }
    const build = (data: Record<string, unknown>) =>
      buildPayload({ id: "n1", type: "combine-videos", data } as SimpleNode, "job-1", inputs)
        .payload as Record<string, unknown>

    it("clamps an over-wide window down to the route's ceiling", () => {
      const payload = build({ smartCutEnabled: true, smartCutFramesPrev: 48, smartCutFramesNext: 30 })
      expect(payload.smartCutFramesPrev).toBe(SMART_CUT_WINDOW_MAX)
      expect(payload.smartCutFramesNext).toBe(SMART_CUT_WINDOW_MAX)
    })

    it("clamps a below-range window up to the floor", () => {
      const payload = build({ smartCutEnabled: true, smartCutFramesPrev: 0, smartCutFramesNext: -3 })
      expect(payload.smartCutFramesPrev).toBe(SMART_CUT_WINDOW_MIN)
      expect(payload.smartCutFramesNext).toBe(SMART_CUT_WINDOW_MIN)
    })

    it("passes a legal window through untouched", () => {
      const payload = build({ smartCutEnabled: true, smartCutFramesPrev: 12, smartCutFramesNext: 4 })
      expect(payload.smartCutFramesPrev).toBe(12)
      expect(payload.smartCutFramesNext).toBe(4)
    })

    it("drops a non-numeric window so the route's own default applies", () => {
      const payload = build({ smartCutEnabled: true, smartCutFramesPrev: "eight", smartCutFramesNext: null })
      expect(payload.smartCutFramesPrev).toBeUndefined()
      expect(payload.smartCutFramesNext).toBeUndefined()
    })
  })
})
