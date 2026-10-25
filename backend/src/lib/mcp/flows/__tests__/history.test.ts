import { describe, expect, it } from "vitest"
import { planHistory, type HistoryJob } from "../history.js"

const IMG = "https://cdn.nodaro.ai/images/aaaaaaaa-0000-0000-0000-000000000001.png"

function job(id: string, at: string, overrides: Partial<HistoryJob> = {}): HistoryJob {
  return {
    id,
    created_at: at,
    completed_at: at,
    source_detail: "Claude Code (nodaro)",
    input_data: { type: "generate-image", prompt: "a lighthouse", provider: "nano-banana-pro", aspectRatio: "16:9", userPrompt: "a lighthouse", resolvedModel: "x" },
    output_data: { imageUrl: IMG },
    ...overrides,
  }
}

describe("planHistory", () => {
  it("groups by connection and pause, files each conversation in the month it started", () => {
    const plan = planHistory([
      job("j1", "2026-09-30T23:50:00Z"),
      job("j2", "2026-10-01T00:10:00Z"),
      job("j3", "2026-10-01T02:00:00Z"),
      job("j4", "2026-10-01T02:05:00Z", { source_detail: "ChatGPT" }),
    ])
    expect(plan.conversations.map((c) => [c.clientName, c.month, c.steps.map((s) => s.jobId)])).toEqual([
      ["Claude Code (nodaro)", "2026-09", ["j1", "j2"]],
      ["Claude Code (nodaro)", "2026-10", ["j3"]],
      ["ChatGPT", "2026-10", ["j4"]],
    ])
    expect(plan.conversations[0].client).toBe("claude-code")
    expect(plan.conversations[2].client).toBe("chatgpt")
  })

  it("leaves a job the node cannot reproduce, one without a result, and one already filed", () => {
    const plan = planHistory(
      [
        job("j1", "2026-10-01T00:00:00Z", { input_data: { type: "video-depth", videoUrl: "v" } }),
        job("j2", "2026-10-01T00:01:00Z", { output_data: {} }),
        job("j3", "2026-10-01T00:02:00Z", { input_data: { type: "generate-image", prompt: "p", provider: "flux", count: 4 } }),
        job("j4", "2026-10-01T00:03:00Z"),
      ],
      new Set(["j4"]),
    )
    expect(plan.conversations).toEqual([])
    expect(plan.skipped).toEqual({
      "no node for video-depth": 1,
      "generate-image: no result": 1,
      "generate-image: the node cannot reproduce it": 1,
      "already in a conversation": 1,
    })
  })

  it("files image-to-video jobs on the unified video node", () => {
    const plan = planHistory([
      job("v1", "2026-10-02T00:00:00Z", {
        input_data: { type: "image-to-video", prompt: "pan", provider: "seedance-2-5", imageUrl: IMG, duration: 5, userPrompt: "pan" },
        output_data: { videoUrl: "https://cdn.nodaro.ai/videos/v1.mp4", thumbnailUrl: "https://cdn.nodaro.ai/t.jpg" },
      }),
    ])
    const [step] = plan.conversations[0].steps
    expect(step.spec.type).toBe("generate-video")
    expect(step.thumbnailUrl).toBe("https://cdn.nodaro.ai/t.jpg")
  })
})
