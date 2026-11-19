// @test-watches backend/src/services/workflow-engine/payload-builder.ts
/**
 * A Video to Video node that stores no model runs the default, Seedance 2.5
 * edit (`videoToVideoProviderOf`): the workflow run builds the very job a node
 * naming that model builds. A node naming Wan 2.6 keeps its own lane and flat row.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { DEFAULT_VIDEO_TO_VIDEO_PROVIDER, QUEUED_VIDEO_TO_VIDEO_JOB_PROVIDER, videoToVideoProviderOf } from "@nodaro/shared/models"
import { seedanceVideoEditCreditId } from "@nodaro/shared/credits"
import { getFactoryPresets } from "@nodaro/prompts/presets"
import { resolvedModelOfJob } from "../../../lib/job-resolved-model.js"

const CLIP = "https://cdn.example.com/clip.mp4"
const node = (data: Record<string, unknown>): SimpleNode => ({ id: "n1", type: "video-to-video", data })
const build = (data: Record<string, unknown>) => buildPayload(node(data), "job-1", { videoUrl: CLIP, prompt: "make it night" })

describe("Video to Video — a node that stores no model", () => {
  it("the default is Seedance 2.5 edit, resolved in one place", () => {
    expect(DEFAULT_VIDEO_TO_VIDEO_PROVIDER).toBe("seedance-2-5")
    for (const unnamed of [undefined, null, "", 7]) expect(videoToVideoProviderOf(unnamed)).toBe("seedance-2-5")
    expect(videoToVideoProviderOf("wan")).toBe("wan")
  })

  it("builds the job a node naming seedance-2-5 builds: an edit on the reference lane, at 480p", () => {
    const bare = build({ prompt: "make it night" })
    const named = build({ prompt: "make it night", provider: "seedance-2-5" })
    expect(bare).toEqual(named)
    expect(bare.jobName).toBe("text-to-video")
    expect(bare.modelIdentifier).toBe(seedanceVideoEditCreditId("seedance-2-5"))
    expect(bare.modelIdentifier).toBe("seedance-2-5:30s:480p-ref")
    expect(bare.payload).toMatchObject({
      provider: "seedance-2-5",
      prompt: "edit @video_1 as follows:\nmake it night",
      aspectRatio: "adaptive",
      resolution: "480p",
      referenceVideoUrls: [CLIP],
      referenceTaskType: "edit",
    })
  })

  it("the levers a node saved under the former default carries reach no Seedance job", () => {
    const bare = build({ prompt: "make it night", duration: 5, v2vDuration: "10", audio: true, multiShots: true, negativePrompt: "blurry" })
    expect(bare.jobName).toBe("text-to-video")
    for (const field of ["multiShots", "audio", "negativePrompt", "videoEditDuration", "audioSetting", "promptExtend"]) {
      expect(bare.payload, field).not.toHaveProperty(field)
    }
    expect(bare.payload.duration).toBe(build({ prompt: "make it night", provider: "seedance-2-5" }).payload.duration)
  })

  it("needs an instruction, as the route does: no prompt is refused before any job, named or not", () => {
    for (const data of [{}, { provider: "seedance-2-5" }, { prompt: "   " }]) {
      expect(() => buildPayload(node(data), "job-1", { videoUrl: CLIP })).toThrow(/prompt_required/)
    }
    // A model of the route's own still runs without one.
    expect(buildPayload(node({ provider: "wan" }), "job-1", { videoUrl: CLIP }).jobName).toBe("video-to-video")
  })

  it("a restyle look with no typed prompt runs: the preset's own text is the instruction", () => {
    for (const preset of getFactoryPresets("video-to-video").filter((p) => p.data.provider === "seedance-2-5")) {
      const result = buildPayload(node({ ...preset.data }), "job-1", { videoUrl: CLIP })
      expect(result.jobName, preset.id).toBe("text-to-video")
      expect(result.payload.prompt, preset.id).toBe(`edit @video_1 as follows:\n${String(preset.data.promptPrefix)}`)
    }
    expect(getFactoryPresets("video-to-video").filter((p) => p.data.provider === "seedance-2-5")).toHaveLength(6)
  })

  it("a node naming wan keeps its own lane, its flat row and its levers", () => {
    const wan = build({ prompt: "on a rooftop", provider: "wan", v2vDuration: "10" })
    expect(wan.jobName).toBe("video-to-video")
    expect(wan.modelIdentifier).toBe("wan")
    expect(wan.payload).toMatchObject({ provider: "wan", videoUrl: CLIP })
  })

  it("a video-to-video job already queued with no provider is still read as the Wan 2.6 job it was", () => {
    expect(QUEUED_VIDEO_TO_VIDEO_JOB_PROVIDER).toBe("wan")
    expect(resolvedModelOfJob("video-to-video", { videoUrl: CLIP })).toBe("wan")
    expect(resolvedModelOfJob("video-to-video", { videoUrl: CLIP, provider: "seedance-2-5" })).toBe("seedance-2-5")
  })
})
