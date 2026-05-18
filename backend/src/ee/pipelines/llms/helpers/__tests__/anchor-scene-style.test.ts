import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))
vi.mock("../../../services/pipeline-generate-image.js", () => ({
  pipelineGenerateImage: vi.fn(),
}))

import { callLLM } from "../../call-llm.js"
import { pipelineGenerateImage } from "../../../services/pipeline-generate-image.js"
import { runAnchorSceneStyle } from "../anchor-scene-style.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  cast: [{ key: "hero", name: "Hero", visual_description: "weathered pilot" }],
  locations: [
    { key: "carrier", name: "Carrier", visual_description: "naval deck" },
  ],
  global_style: {
    visual_style: "x",
    color_palette: "x",
    lighting: "x",
    camera_language: "x",
  },
} as never

const fakeScene = {
  description: "Hero on the runway",
  emotional_beat: "setup",
  cast_keys: ["hero"],
  location_key: "carrier",
  image_model: "nano-banana-2",
} as never

describe("runAnchorSceneStyle", () => {
  it("plans prompt via Sonnet, generates via pipelineGenerateImage, returns combined result", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { anchor_prompt: "Wide cinematic shot of a hero on a carrier deck, golden hour" },
      llmCallId: "x",
      costUsd: 0.01,
      inputTokens: 800,
      outputTokens: 200,
    })
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/anchor.png",
      creditsSpent: 2,
    })

    const result = await runAnchorSceneStyle({
      supabase: {} as never,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      stageId: "s5",
      userId: "u1",
      plan: fakePlan,
      scene: fakeScene,
    })

    expect(result.anchor_prompt).toBe(
      "Wide cinematic shot of a hero on a carrier deck, golden hour",
    )
    expect(result.asset_id).toBe("a1")
    expect(result.asset_url).toBe("https://r2/anchor.png")
    expect(result.scene_id).toBe("scene-1")
    // credits_spent = image creditsSpent (2) + ceil(LLM costUsd 0.01 / CREDIT_BASE_USD 0.02) = 2 + 1 = 3
    expect(result.credits_spent).toBe(3)

    expect(callLLM).toHaveBeenCalledTimes(1)
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
    const llmArgs = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(llmArgs.role).toBe("helper")
    expect(llmArgs.task).toBe("anchor_scene_style")
    expect(llmArgs.modelId).toBe("claude-sonnet-4-6")
    expect(llmArgs.sceneId).toBe("scene-1")
    // Image gen passed through the planned anchor prompt + scene's image_model
    const imgArgs = (pipelineGenerateImage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(imgArgs.prompt).toBe(
      "Wide cinematic shot of a hero on a carrier deck, golden hour",
    )
    expect(imgArgs.modelIdentifier).toBe("nano-banana-2")
    expect(imgArgs.pipelineEntityId).toBe("scene-1")
  })
})
