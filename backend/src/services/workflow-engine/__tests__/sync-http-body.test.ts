/**
 * Regression tests for `buildSyncHttpBody` — the function that shapes the JSON
 * body the orchestrator POSTs to internal sync-HTTP routes (AI composers,
 * social posts, etc.).
 *
 * Historical bugs:
 *   - after-effects/lottie-overlay sent `videoUrl` instead of `inputVideoUrl`
 *   - lottie-overlay never collected lottieAssets from upstream edges
 *   - llm-chat (Generate Text) forwarded only referenceImageUrls, dropping
 *     referenceVideoUrls + referenceAudioUrls in server-side DAG runs while
 *     single-node Run sent all three (design §6.14 "GAP A")
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

  describe("llm-chat (Generate Text)", () => {
    it("forwards image + video + audio references (GAP A)", () => {
      const body = buildSyncHttpBody(
        node("llm-chat", { systemPrompt: "s", userInput: "u" }),
        {
          prompt: "u",
          referenceImageUrls: ["https://i.png"],
          referenceVideoUrls: ["https://v.mp4"],
          referenceAudioUrls: ["https://a.mp3"],
        },
        CTX,
      )
      // Pre-GAP-A the body dropped video + audio arrays, so Gemini multimodal
      // refs silently vanished in server-side DAG runs (single-node Run sent
      // all three). All three must now be present and forwarded verbatim.
      expect(body).toMatchObject({
        referenceImageUrls: ["https://i.png"],
        referenceVideoUrls: ["https://v.mp4"],
        referenceAudioUrls: ["https://a.mp3"],
      })
    })

    it("is typed-primary: node-data systemPrompt + userInput win over wired (computeLlmChatFields)", () => {
      // Pre-unification this was wire-primary (`resolvedInputs.X || data.X`),
      // which diverged from the frontend executor + payload-builder. Both engines
      // are now typed-primary via the shared helper: a non-empty typed field wins
      // over the wired value.
      const typedWins = buildSyncHttpBody(
        node("llm-chat", { systemPrompt: "data-sys", userInput: "data-user" }),
        { systemPrompt: "wired-sys", prompt: "wired-user" },
        CTX,
      )
      expect(typedWins.systemPrompt).toBe("data-sys")
      expect(typedWins.userInput).toBe("data-user")
    })

    it("falls back to the wired value per-field when the typed field is empty", () => {
      // Each field resolves independently: empty typed → wired.
      const fromWired = buildSyncHttpBody(
        node("llm-chat", { systemPrompt: "", userInput: "" }),
        { systemPrompt: "wired-sys", prompt: "wired-user" },
        CTX,
      )
      expect(fromWired.systemPrompt).toBe("wired-sys")
      expect(fromWired.userInput).toBe("wired-user")
    })

    it("falls back to node data when nothing is wired", () => {
      const fromData = buildSyncHttpBody(
        node("llm-chat", { systemPrompt: "data-sys", userInput: "data-user" }),
        {},
        CTX,
      )
      expect(fromData.systemPrompt).toBe("data-sys")
      expect(fromData.userInput).toBe("data-user")
    })

    it("override (list fan-out) wins for userInput only, never systemPrompt", () => {
      const body = buildSyncHttpBody(
        node("llm-chat", { systemPrompt: "data-sys", userInput: "data-user" }),
        { overridePrompt: "item-3", systemPrompt: "wired-sys", prompt: "wired-user" },
        CTX,
      )
      expect(body.userInput).toBe("item-3")
      // override does NOT apply to systemPrompt → typed-primary still wins there.
      expect(body.systemPrompt).toBe("data-sys")
    })
  })

  describe("social posts (caption precedence)", () => {
    it("is typed-primary: node-data caption wins over the wired caption", () => {
      // Old expr was wire-primary (`resolvedInputs.prompt || resolvedInputs.caption
      // || data.caption || data.text`). Now typed-primary via computeNodePrompt
      // (NODE_PROMPT_CANDIDATE_FIELDS[<platform>] === ["caption"]).
      const body = buildSyncHttpBody(
        node("instagram-post", { caption: "data-cap", connectionId: "c1" }),
        { caption: "wired-cap" },
        CTX,
      )
      expect(body.caption).toBe("data-cap")
      expect(body.platform).toBe("instagram")
    })

    it("falls back to the wired caption (resolvedInputs.caption) when data.caption is empty", () => {
      // input-resolver routes a text upstream into resolvedInputs.caption for
      // social nodes (not resolvedInputs.prompt).
      const body = buildSyncHttpBody(
        node("telegram-post", { caption: "", chatId: "123" }),
        { caption: "wired-cap" },
        CTX,
      )
      expect(body.caption).toBe("wired-cap")
    })

    it("override (list fan-out) wins over both typed + wired caption", () => {
      const body = buildSyncHttpBody(
        node("x-post", { caption: "data-cap" }),
        { overridePrompt: "item-2", caption: "wired-cap" },
        CTX,
      )
      expect(body.caption).toBe("item-2")
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

  describe("reduce (fan-in)", () => {
    it("constructs body { strategyId, strategyConfig, inputs, workflowId, userId }", () => {
      const body = buildSyncHttpBody(
        node("reduce", { strategyId: "concat", strategyConfig: { separator: "-" } }),
        { inputs: ["a", "b", "c"] },
        CTX,
      )
      expect(body.strategyId).toBe("concat")
      expect(body.strategyConfig).toEqual({ separator: "-" })
      expect(body.inputs).toEqual(["a", "b", "c"])
      // The route reads `body.workflowId` via `extractWorkflowId` — sending
      // `workflowExecutionId` would be silently dropped (was a bug pre-#2693).
      expect(body.workflowId).toBe("wf-1")
      expect(body.workflowExecutionId).toBeUndefined()
      expect(body.userId).toBe("user-1")
    })

    it("defaults strategyId to 'concat' and strategyConfig to {} when missing", () => {
      const body = buildSyncHttpBody(
        node("reduce"),
        { inputs: ["x"] },
        CTX,
      )
      expect(body.strategyId).toBe("concat")
      expect(body.strategyConfig).toEqual({})
      expect(body.inputs).toEqual(["x"])
    })

    it("falls back to empty inputs array when resolved input list is missing", () => {
      const body = buildSyncHttpBody(
        node("reduce", { strategyId: "vote", strategyConfig: { caseSensitive: false } }),
        {},
        CTX,
      )
      expect(body.strategyId).toBe("vote")
      expect(body.strategyConfig).toEqual({ caseSensitive: false })
      expect(body.inputs).toEqual([])
    })
  })
})
