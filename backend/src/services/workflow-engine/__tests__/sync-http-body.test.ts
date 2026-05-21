/**
 * Regression tests for `buildSyncHttpBody` — the function that shapes the JSON
 * body the orchestrator POSTs to internal sync-HTTP routes (AI composers,
 * social posts, etc.).
 *
 * Historical bugs:
 *   - after-effects/lottie-overlay sent `videoUrl` instead of `inputVideoUrl`
 *   - lottie-overlay never collected lottieAssets from upstream edges
 */

import { describe, it, expect } from "vitest"
import { buildSyncHttpBody } from "../node-executor.js"
import type { SimpleNode, ResolvedInputs, OrchestratorContext } from "../types.js"

function node(type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id: "n1", type, data }
}

const CTX: OrchestratorContext = {
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
}

describe("buildSyncHttpBody — field shape matches route Zod schemas", () => {
  describe("after-effects", () => {
    it("sends inputVideoUrl (not videoUrl) per route schema", () => {
      const body = buildSyncHttpBody(
        node("after-effects", { effectPrompt: "glow", fps: 30 }),
        { videoUrl: "https://v.mp4" },
        CTX,
      )
      expect(body.inputVideoUrl).toBe("https://v.mp4")
      expect(body.videoUrl).toBeUndefined()
      expect(body.prompt).toBe("glow")
      expect(body.fps).toBe(30)
    })

    it("falls back to node data sourceVideoUrl when no upstream video", () => {
      const body = buildSyncHttpBody(
        node("after-effects", { effectPrompt: "glow", sourceVideoUrl: "https://saved.mp4" }),
        {},
        CTX,
      )
      expect(body.inputVideoUrl).toBe("https://saved.mp4")
    })
  })

  describe("lottie-overlay", () => {
    it("sends inputVideoUrl (not videoUrl) per route schema", () => {
      const body = buildSyncHttpBody(
        node("lottie-overlay", { overlayPrompt: "sparkles" }),
        { videoUrl: "https://v.mp4" },
        CTX,
      )
      expect(body.inputVideoUrl).toBe("https://v.mp4")
      expect(body.videoUrl).toBeUndefined()
    })

    it("forwards upstream-resolved lottieAssets to the route", () => {
      const lottieAssets = [
        { id: "l1", url: "https://lottie/a.json", name: "Sparkle" },
        { id: "l2", url: "https://lottie/b.json", name: "Glow" },
      ]
      const body = buildSyncHttpBody(
        node("lottie-overlay", { overlayPrompt: "test" }),
        { videoUrl: "https://v.mp4", lottieAssets },
        CTX,
      )
      expect(body.lottieAssets).toEqual(lottieAssets)
    })

    it("falls back to node data lottieAssets when no upstream provided", () => {
      const dataAssets = [{ url: "https://lottie/saved.json", name: "Saved" }]
      const body = buildSyncHttpBody(
        node("lottie-overlay", { overlayPrompt: "test", lottieAssets: dataAssets }),
        { videoUrl: "https://v.mp4" },
        CTX,
      )
      expect(body.lottieAssets).toEqual(dataAssets)
    })

    it("sends undefined lottieAssets when neither upstream nor data has any", () => {
      const body = buildSyncHttpBody(
        node("lottie-overlay", { overlayPrompt: "test" }),
        { videoUrl: "https://v.mp4" },
        CTX,
      )
      expect(body.lottieAssets).toBeUndefined()
    })
  })

  describe("video-composer", () => {
    it("builds assets array from resolved media inputs", () => {
      const body = buildSyncHttpBody(
        node("video-composer", { compositionPrompt: "montage", fps: 30 }),
        {
          referenceImageUrls: ["https://img1.png"],
          videoUrl: "https://v.mp4",
          audioUrl: "https://a.mp3",
        },
        CTX,
      )
      const assets = body.assets as Array<{ type: string; url: string }>
      expect(assets).toHaveLength(3)
      expect(assets.some((a) => a.type === "image" && a.url === "https://img1.png")).toBe(true)
      expect(assets.some((a) => a.type === "video" && a.url === "https://v.mp4")).toBe(true)
      expect(assets.some((a) => a.type === "audio" && a.url === "https://a.mp3")).toBe(true)
    })
  })

  describe("3d-title", () => {
    it("resolves backgroundMediaUrl from upstream video or image", () => {
      const body = buildSyncHttpBody(
        node("3d-title", { titlePrompt: "Hero" }),
        { imageUrl: "https://img.png" },
        CTX,
      )
      expect(body.backgroundMediaUrl).toBe("https://img.png")
      expect(body.prompt).toBe("Hero")
    })
  })

  describe("collect (fan-in)", () => {
    it("constructs body { strategyId, strategyConfig, inputs, workflowExecutionId, userId }", () => {
      const body = buildSyncHttpBody(
        node("collect", { strategyId: "concat", strategyConfig: { separator: "-" } }),
        { inputs: ["a", "b", "c"] },
        CTX,
      )
      expect(body.strategyId).toBe("concat")
      expect(body.strategyConfig).toEqual({ separator: "-" })
      expect(body.inputs).toEqual(["a", "b", "c"])
      expect(body.workflowExecutionId).toBe("exec-1")
      expect(body.userId).toBe("user-1")
    })

    it("defaults strategyId to 'concat' and strategyConfig to {} when missing", () => {
      const body = buildSyncHttpBody(
        node("collect"),
        { inputs: ["x"] },
        CTX,
      )
      expect(body.strategyId).toBe("concat")
      expect(body.strategyConfig).toEqual({})
      expect(body.inputs).toEqual(["x"])
    })

    it("falls back to empty inputs array when resolved input list is missing", () => {
      const body = buildSyncHttpBody(
        node("collect", { strategyId: "vote", strategyConfig: { caseSensitive: false } }),
        {},
        CTX,
      )
      expect(body.strategyId).toBe("vote")
      expect(body.strategyConfig).toEqual({ caseSensitive: false })
      expect(body.inputs).toEqual([])
    })
  })
})
