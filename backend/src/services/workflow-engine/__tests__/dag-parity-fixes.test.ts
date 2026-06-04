/**
 * Regression tests for DAG execution parity fixes.
 *
 * Context: this file exists because the DAG parity audit on 2026-04-17 found
 * 13 cases where backend orchestrator execution produced different results
 * than single-node execution. These tests lock in the fixes so future edits
 * to payload-builder / node-executor / output-extractor / input-resolver
 * cannot silently re-introduce the mismatches.
 */

import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { buildNodeOutputFromJobData } from "../output-extractor.js"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeExecutionState } from "../types.js"

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
// Fix: entity nodes (character, face, object, location) must build the same
// prompt the route would, rather than sending only `description`.
// ---------------------------------------------------------------------------

describe("entity nodes — orchestrator replicates route prompt building", () => {
  it("character includes name, gender, description, baseOutfit, style", () => {
    const n = node("c1", "character", {
      name: "Aria",
      gender: "female",
      description: "silver hair, green eyes",
      baseOutfit: "leather armour",
      style: "anime",
    })
    const result = buildPayload(n, JOB_ID, {})
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("Aria")
    expect(prompt).toContain("female")
    expect(prompt).toContain("silver hair, green eyes")
    expect(prompt).toContain("wearing leather armour")
    expect(prompt).toContain("anime style")
    expect(prompt).toContain("front view")
    expect(result.jobName).toBe("generate-character")
  })

  it("character falls back to raw description when name is missing (legacy nodes)", () => {
    const n = node("c1", "character", { description: "a cyborg warrior" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.prompt).toBe("a cyborg warrior")
  })

  it("object includes name, category, description, style", () => {
    const n = node("o1", "object", {
      name: "flintlock pistol",
      category: "weapon",
      description: "brass fittings",
      style: "realistic",
    })
    const result = buildPayload(n, JOB_ID, {})
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("weapon flintlock pistol")
    expect(prompt).toContain("brass fittings")
    expect(prompt).toContain("realistic art style")
    expect(result.jobName).toBe("generate-object")
  })

  it("location includes name, category, description, style", () => {
    const n = node("l1", "location", {
      name: "Neo Tokyo rooftop",
      category: "urban",
      description: "neon signs, rain",
      style: "3d-pixar",
    })
    const result = buildPayload(n, JOB_ID, {})
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("urban scene")
    expect(prompt).toContain("Neo Tokyo rooftop")
    expect(prompt).toContain("neon signs, rain")
    expect(prompt).toContain("3d-pixar art style")
    expect(result.jobName).toBe("generate-location")
  })

  it("face uses face-generation template with description + style", () => {
    const n = node("f1", "face", {
      name: "Elena",
      description: "high cheekbones",
      style: "realistic",
    })
    const result = buildPayload(n, JOB_ID, {})
    const prompt = result.payload.prompt as string
    expect(prompt).toBeTruthy()
    // Template resolution should have happened — prompt should contain the
    // description (not just placeholder).
    expect(prompt).toContain("Elena")
  })

  it("entity nodes forward sourceImageUrl from node data", () => {
    const n = node("c1", "character", {
      name: "Aria",
      sourceImageUrl: "https://example.com/ref.png",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.sourceImageUrl).toBe("https://example.com/ref.png")
  })
})

// ---------------------------------------------------------------------------
// Fix: generate-script must forward llmModel and use buildLlmCreditIdentifier
// ---------------------------------------------------------------------------

describe("generate-script — tiered credit + llmModel forwarding", () => {
  it("uses tiered credit identifier for economy model", () => {
    const n = node("s1", "generate-script", {
      prompt: "storyboard",
      llmModel: "gemini-3-flash",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("generate-script:economy")
    expect(result.payload.llmModel).toBe("gemini-3-flash")
  })

  it("uses flat identifier for default/unknown model", () => {
    const n = node("s1", "generate-script", { prompt: "storyboard" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("generate-script")
    expect(result.payload.llmModel).toBeUndefined()
  })

  it("uses premium identifier for premium-tier model", () => {
    const n = node("s1", "generate-script", {
      prompt: "storyboard",
      llmModel: "gpt-5.4",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("generate-script:premium")
  })
})

// ---------------------------------------------------------------------------
// Fix: lip-sync infinitalk uses composite credit identifier
// ---------------------------------------------------------------------------

describe("lip-sync — infinitalk composite credit identifier", () => {
  it("uses composite id for infinitalk 720p", () => {
    const n = node("l1", "lip-sync", {
      provider: "infinitalk",
      resolution: "720p",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("infinitalk:720p")
  })

  it("uses composite id for infinitalk 480p", () => {
    const n = node("l1", "lip-sync", {
      provider: "infinitalk",
      resolution: "480p",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("infinitalk:480p")
  })

  it("uses bare provider id for per-second providers when duration is unknown", () => {
    // kling-avatar keeps its existing bare reservation when audioDurationSec is absent.
    const n = node("l1", "lip-sync", { provider: "kling-avatar" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("kling-avatar")
  })

  it("buckets per-second providers by audio duration when it is known", () => {
    const kling = buildPayload(node("l1", "lip-sync", { provider: "kling-avatar", audioDurationSec: 12 }), JOB_ID, {})
    expect(kling.modelIdentifier).toBe("kling-avatar:15s")
    const heygen = buildPayload(node("l2", "lip-sync", { provider: "heygen-lipsync-precision", audioDurationSec: 45 }), JOB_ID, {})
    expect(heygen.modelIdentifier).toBe("heygen-lipsync-precision:60s")
    const sync = buildPayload(node("l3", "lip-sync", { provider: "lipsync-2-pro", audioDurationSec: 200 }), JOB_ID, {})
    expect(sync.modelIdentifier).toBe("lipsync-2-pro:300s")
  })

  it("falls back to the bare (5-min ceiling) id for HeyGen/Sync when duration is unknown", () => {
    const heygen = buildPayload(node("l1", "lip-sync", { provider: "heygen-lipsync-precision" }), JOB_ID, {})
    expect(heygen.modelIdentifier).toBe("heygen-lipsync-precision")
    const sync = buildPayload(node("l2", "lip-sync", { provider: "lipsync-2-pro" }), JOB_ID, {})
    expect(sync.modelIdentifier).toBe("lipsync-2-pro")
  })

  it("defaults infinitalk resolution to 720p", () => {
    const n = node("l1", "lip-sync", { provider: "infinitalk" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("infinitalk:720p")
  })
})

// ---------------------------------------------------------------------------
// Fix: suno-separate split_stem uses suno-separate-stem credit identifier
// ---------------------------------------------------------------------------

describe("suno-separate — split_stem charges higher credit tier", () => {
  it("uses suno-separate-stem for split_stem type", () => {
    const n = node("s1", "suno-separate", {
      type: "split_stem",
      sunoTaskId: "t1",
      sunoTrackId: "tr1",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("suno-separate-stem")
    expect(result.payload.type).toBe("split_stem")
  })

  it("uses suno-separate for separate_vocal type (default)", () => {
    const n = node("s1", "suno-separate", { sunoTaskId: "t1", sunoTrackId: "tr1" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.modelIdentifier).toBe("suno-separate")
    expect(result.payload.type).toBe("separate_vocal")
  })
})

// ---------------------------------------------------------------------------
// Fix: trim-video forwards outputSilentVideo to the worker
// ---------------------------------------------------------------------------

describe("trim-video — forwards outputSilentVideo flag", () => {
  it("passes outputSilentVideo=true to worker payload", () => {
    const n = node("t1", "trim-video", {
      videoUrl: "https://v.mp4",
      startTime: 1,
      endTime: 5,
      outputSilentVideo: true,
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.outputSilentVideo).toBe(true)
  })

  it("omits outputSilentVideo when flag is undefined", () => {
    const n = node("t1", "trim-video", { videoUrl: "https://v.mp4" })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.outputSilentVideo).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Fix: generate-music forwards modelVersion
// ---------------------------------------------------------------------------

describe("generate-music — forwards modelVersion", () => {
  it("passes modelVersion from node data", () => {
    const n = node("m1", "generate-music", {
      prompt: "jazz",
      modelVersion: "V5",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.modelVersion).toBe("V5")
  })
})

// ---------------------------------------------------------------------------
// Fix: mix-audio trackVolumes Record -> ordered number[]
// ---------------------------------------------------------------------------

describe("mix-audio — trackVolumes converted to ordered array", () => {
  it("converts Record<nodeId, number> to number[] aligned with audioUrls", () => {
    const n = node("m1", "mix-audio", {
      trackVolumes: { a1: 75, a2: 50, a3: 100 },
    })
    const inputs: ResolvedInputs = {
      audioUrlsWithSourceIds: [
        { nodeId: "a1", url: "https://audio1.mp3" },
        { nodeId: "a2", url: "https://audio2.mp3" },
      ],
    }
    const result = buildPayload(n, JOB_ID, inputs)
    expect(result.payload.audioUrls).toEqual([
      "https://audio1.mp3",
      "https://audio2.mp3",
    ])
    expect(result.payload.trackVolumes).toEqual([75, 50])
  })

  it("defaults missing nodeIds to 100", () => {
    const n = node("m1", "mix-audio", { trackVolumes: { a1: 25 } })
    const inputs: ResolvedInputs = {
      audioUrlsWithSourceIds: [
        { nodeId: "a1", url: "https://a.mp3" },
        { nodeId: "a2", url: "https://b.mp3" },
      ],
    }
    const result = buildPayload(n, JOB_ID, inputs)
    expect(result.payload.trackVolumes).toEqual([25, 100])
  })

  it("honours trackOrder when reordering tracks", () => {
    const n = node("m1", "mix-audio", {
      trackVolumes: { a1: 30, a2: 60 },
      trackOrder: ["a2", "a1"],
    })
    const inputs: ResolvedInputs = {
      audioUrlsWithSourceIds: [
        { nodeId: "a1", url: "https://a.mp3" },
        { nodeId: "a2", url: "https://b.mp3" },
      ],
    }
    const result = buildPayload(n, JOB_ID, inputs)
    expect(result.payload.audioUrls).toEqual(["https://b.mp3", "https://a.mp3"])
    expect(result.payload.trackVolumes).toEqual([60, 30])
  })

  it("falls back to data.volumes array when no source IDs available", () => {
    const n = node("m1", "mix-audio", {
      audioUrls: ["https://a.mp3", "https://b.mp3"],
      volumes: [75, 25],
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.trackVolumes).toEqual([75, 25])
  })
})

// ---------------------------------------------------------------------------
// Fix: suno-upload-extend uses `uploadUrl` + non-negative continueAt
// ---------------------------------------------------------------------------

describe("suno-upload-extend — route-compatible payload", () => {
  it("forwards uploadUrl from resolved audioUrl upstream", () => {
    const n = node("s1", "suno-upload-extend", { model: "V5" })
    const inputs: ResolvedInputs = { audioUrl: "https://source.mp3" }
    const result = buildPayload(n, JOB_ID, inputs)
    expect(result.payload.uploadUrl).toBe("https://source.mp3")
  })

  it("defaults continueAt to 0 when missing", () => {
    const n = node("s1", "suno-upload-extend", {
      uploadUrl: "https://a.mp3",
      model: "V5",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.continueAt).toBe(0)
  })

  it("respects explicit continueAt from node data", () => {
    const n = node("s1", "suno-upload-extend", {
      uploadUrl: "https://a.mp3",
      continueAt: 42,
      model: "V5",
    })
    const result = buildPayload(n, JOB_ID, {})
    expect(result.payload.continueAt).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// Fix: output-extractor maps save-to-storage output_data.url by `type`
// ---------------------------------------------------------------------------

describe("buildNodeOutputFromJobData — save-to-storage url mapping", () => {
  it("routes { url, type: 'video' } to videoUrl", () => {
    const out = buildNodeOutputFromJobData(
      { url: "https://r2/file.mp4", type: "video" },
      "save-to-storage",
    )
    expect(out.videoUrl).toBe("https://r2/file.mp4")
  })

  it("routes { url, type: 'audio' } to audioUrl", () => {
    const out = buildNodeOutputFromJobData(
      { url: "https://r2/file.mp3", type: "audio" },
      "save-to-storage",
    )
    expect(out.audioUrl).toBe("https://r2/file.mp3")
  })

  it("routes { url, type: 'image' } to imageUrl", () => {
    const out = buildNodeOutputFromJobData(
      { url: "https://r2/file.png", type: "image" },
      "save-to-storage",
    )
    expect(out.imageUrl).toBe("https://r2/file.png")
  })

  it("does not overwrite existing typed URL keys", () => {
    const out = buildNodeOutputFromJobData(
      {
        videoUrl: "https://primary.mp4",
        url: "https://other.mp4",
        type: "video",
      },
      "save-to-storage",
    )
    expect(out.videoUrl).toBe("https://primary.mp4")
  })
})

// ---------------------------------------------------------------------------
// Fix: lottie-overlay collects upstream lottie-tagged assets via input-resolver
// ---------------------------------------------------------------------------

describe("input-resolver — lottie assets from targetHandle=lottie", () => {
  it("collects lottieAssets from upstream nodes wired to the lottie handle", () => {
    const lottieSrc = node("lottie1", "upload-audio", { label: "Sparkle FX" })
    const target = node("lo1", "lottie-overlay", {})
    const videoSrc = node("v1", "upload-video", { url: "https://v.mp4" })

    const edges: SimpleEdge[] = [
      edge("lottie1", "lo1", null, "lottie"),
      edge("v1", "lo1", null, null),
    ]
    const states: Record<string, NodeExecutionState> = {
      lottie1: {
        status: "completed",
        output: { audioUrl: "https://lottie-asset.json" },
      },
    }

    const inputs = resolveNodeInputs(target, edges, states, [target, lottieSrc, videoSrc])
    expect(inputs.lottieAssets).toHaveLength(1)
    expect(inputs.lottieAssets?.[0]).toMatchObject({
      id: "lottie1",
      url: "https://lottie-asset.json",
      name: "Sparkle FX",
    })
    // Video upstream should route to videoUrl, not be treated as a lottie asset
    expect(inputs.videoUrl).toBe("https://v.mp4")
  })

  it("ignores non-URL values on the lottie handle", () => {
    const lottieSrc = node("l1", "text-prompt", { text: "not a url" })
    const target = node("lo1", "lottie-overlay", {})
    const edges: SimpleEdge[] = [edge("l1", "lo1", null, "lottie")]
    const states: Record<string, NodeExecutionState> = {
      l1: { status: "completed", output: { text: "not a url" } },
    }
    const inputs = resolveNodeInputs(target, edges, states, [target, lottieSrc])
    expect(inputs.lottieAssets).toBeUndefined()
  })
})
