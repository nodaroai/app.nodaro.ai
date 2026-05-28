import { describe, it, expect } from "vitest"
import { resolvePipelineModel, type PipelineConfig } from "../pipeline-types.js"

describe("resolvePipelineModel", () => {
  it("returns undefined when config is null/undefined", () => {
    expect(resolvePipelineModel(undefined, "characters_image")).toBeUndefined()
    expect(resolvePipelineModel(null, "shots_video")).toBeUndefined()
  })

  it("returns undefined when neither stage_models nor global field is set", () => {
    const config: Partial<PipelineConfig> = {}
    expect(resolvePipelineModel(config, "characters_image")).toBeUndefined()
    expect(resolvePipelineModel(config, "shots_video")).toBeUndefined()
    expect(resolvePipelineModel(config, "script_llm")).toBeUndefined()
  })

  it("returns the global image_model for any *_image stage when stage_models is absent", () => {
    const config: Partial<PipelineConfig> = { image_model: "flux" }
    expect(resolvePipelineModel(config, "characters_image")).toBe("flux")
    expect(resolvePipelineModel(config, "locations_image")).toBe("flux")
    expect(resolvePipelineModel(config, "objects_image")).toBe("flux")
    expect(resolvePipelineModel(config, "scene_keyframes_image")).toBe("flux")
  })

  it("returns the global video_model for *_video stages", () => {
    const config: Partial<PipelineConfig> = { video_model: "kling" }
    expect(resolvePipelineModel(config, "shots_video")).toBe("kling")
  })

  it("returns the global script_llm for the script_llm stage", () => {
    const config: Partial<PipelineConfig> = { script_llm: "claude-opus-4-6" }
    expect(resolvePipelineModel(config, "script_llm")).toBe("claude-opus-4-6")
  })

  it("per-stage override beats the matching global field", () => {
    const config: Partial<PipelineConfig> = {
      image_model: "flux",
      stage_models: { characters_image: "nano-banana-pro" },
    }
    expect(resolvePipelineModel(config, "characters_image")).toBe("nano-banana-pro")
    // Sibling stages still get the global pick.
    expect(resolvePipelineModel(config, "locations_image")).toBe("flux")
    expect(resolvePipelineModel(config, "objects_image")).toBe("flux")
    expect(resolvePipelineModel(config, "scene_keyframes_image")).toBe("flux")
  })

  it("per-stage overrides work independently across kinds", () => {
    const config: Partial<PipelineConfig> = {
      image_model: "flux",
      video_model: "kling",
      script_llm: "claude-sonnet-4-6",
      stage_models: {
        scene_keyframes_image: "gpt-image",
        shots_video: "veo3",
        script_llm: "claude-opus-4-6",
      },
    }
    expect(resolvePipelineModel(config, "scene_keyframes_image")).toBe("gpt-image")
    expect(resolvePipelineModel(config, "shots_video")).toBe("veo3")
    expect(resolvePipelineModel(config, "script_llm")).toBe("claude-opus-4-6")
    // Entity image stages keep the global pick.
    expect(resolvePipelineModel(config, "characters_image")).toBe("flux")
  })

  it("an explicit empty string in stage_models is treated as 'not set' so the global wins", () => {
    // Common pattern when a frontend clears a select to "Auto" — sending "" is
    // equivalent to omitting the key. The resolver MUST NOT propagate "" as a
    // model identifier (it would later be rejected as an unknown model with a
    // confusing error).
    const config: Partial<PipelineConfig> = {
      image_model: "flux",
      stage_models: { characters_image: "" },
    }
    expect(resolvePipelineModel(config, "characters_image")).toBe("flux")
  })
})
