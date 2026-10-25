import { describe, expect, it } from "vitest"
import { buildPayload } from "../../../../services/workflow-engine/payload-builder.js"
import type { SimpleNode } from "../../../../services/workflow-engine/types.js"
import { FLOW_TOOLS, MAPPED_ROUTES, flowNodeFor } from "../node-mappers.js"

/** The tool each test route is called by. */
const TOOL: Record<string, string> = {
  "/v1/generate-image": "generate_image",
  "/v1/image-to-image": "modify_image",
  "/v1/generate-video": "animate_image",
  "/v1/text-to-video": "generate_video",
}
const nodeFor = (route: string, body: unknown) => flowNodeFor(route, body, TOOL[route] ?? "generate_image")


const IMG = "https://media.nodaro.ai/images/11111111-2222-3333-4444-555555555555.png"
const TRANSPORT = { mcp_client: "Claude", userId: "u1" }

describe("flowNodeFor", () => {
  it("maps a generate_image body onto a Generate Image node, its references as inputs", () => {
    const spec = nodeFor("/v1/generate-image", {
      ...TRANSPORT,
      prompt: "two dolphins by a boat",
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: undefined,
      negativePrompt: undefined,
      referenceImageUrls: [IMG],
    })
    expect(spec?.type).toBe("generate-image")
    expect(spec?.data).toMatchObject({ prompt: "two dolphins by a boat", provider: "nano-banana-pro", aspectRatio: "16:9", resolution: "2K" })
    expect(spec?.data).not.toHaveProperty("quality")
    expect(spec?.inputs).toEqual([{ url: IMG, kind: "image", targetHandle: "references" }])
  })

  it("maps no node for a body carrying a field the node cannot hold", () => {
    expect(nodeFor("/v1/generate-image", { ...TRANSPORT, prompt: "x", provider: "flux", count: 4 })).toBeNull()
    expect(nodeFor("/v1/generate-image", { ...TRANSPORT, prompt: "x", models: ["a", "b"] })).toBeNull()
    expect(nodeFor("/v1/generate-image", { ...TRANSPORT, prompt: "x", provider: "flux", direction: { style: "moodboard:1" } })).toBeNull()
  })

  it("maps no node for a route it does not know", () => {
    expect(nodeFor("/v1/video-depth", { prompt: "x" })).toBeNull()
  })

  it("wires the image a modify_image call edits first, then its references", () => {
    const ref = "https://media.nodaro.ai/uploads/ref.png"
    const spec = nodeFor("/v1/image-to-image", { ...TRANSPORT, imageUrl: IMG, prompt: "at night", provider: "nano-banana-edit", referenceImageUrls: [ref] })
    expect(spec?.type).toBe("modify-image")
    expect(spec?.inputs.map((i) => [i.url, i.targetHandle])).toEqual([[IMG, "image"], [ref, "image"]])
  })

  it("maps both video lanes onto one Generate Video node, the start frame on its handle", () => {
    const i2v = nodeFor("/v1/generate-video", { ...TRANSPORT, imageUrl: IMG, prompt: "jump", provider: "grok-i2v", duration: 6 })
    expect(i2v?.type).toBe("generate-video")
    expect(i2v?.inputs).toEqual([{ url: IMG, kind: "image", targetHandle: "startFrame" }])
    const t2v = nodeFor("/v1/text-to-video", { ...TRANSPORT, prompt: "a plane", provider: "seedance", duration: 5, sound: true })
    expect(t2v?.data).toMatchObject({ provider: "seedance", duration: 5, sound: true })
    expect(t2v?.inputs).toEqual([])
  })

  it("maps a call only for the tools a route lists (each takes user_request)", () => {
    expect(flowNodeFor("/v1/text-to-video", { prompt: "x", provider: "seedance" }, "modify_video")).toBeNull()
    expect(flowNodeFor("/v1/generate-image", { prompt: "x", provider: "flux" }, undefined)).toBeNull()
    expect([...FLOW_TOOLS].sort()).toEqual([
      "add_captions", "animate_image", "audio_isolation", "combine_videos", "edit_image", "extend_video",
      "extract_frame", "face_swap", "generate_dialogue", "generate_image", "generate_music",
      "generate_speech", "generate_video", "gif_to_video", "image_collage", "image_overlay", "image_to_image",
      "lip_sync", "loop_video", "mask_composite", "merge_video_audio", "mix_audio", "modify_image",
      "modify_video", "motion_transfer", "pitch_tempo", "suno_generate", "text_to_audio", "trim_audio",
      "trim_video", "video_upscale", "voice_changer", "voice_design",
    ])
  })

  it("lists exactly the routes it maps", () => {
    expect([...MAPPED_ROUTES].sort()).toEqual([
      "/v1/add-captions", "/v1/audio-isolation", "/v1/combine-videos", "/v1/edit-image", "/v1/extend-video",
      "/v1/extract-frame", "/v1/face-swap", "/v1/generate-image", "/v1/generate-music", "/v1/generate-video",
      "/v1/gif-to-video", "/v1/image-collage", "/v1/image-overlay", "/v1/image-to-image", "/v1/lip-sync",
      "/v1/loop-video", "/v1/mask-composite", "/v1/merge-video-audio", "/v1/mix-audio", "/v1/motion-transfer",
      "/v1/pitch-tempo", "/v1/suno/generate", "/v1/text-to-audio", "/v1/text-to-dialogue",
      "/v1/text-to-speech", "/v1/text-to-video", "/v1/trim-audio", "/v1/trim-video", "/v1/video-to-video",
      "/v1/video-upscale", "/v1/voice-changer", "/v1/voice-design",
    ])
  })
})

/**
 * The invariant: a node built from a verb call, run by the server engine,
 * asks for what the verb asked for. A mapper that drifts from the node's data
 * shape fails here instead of shipping a node whose Run makes something else.
 */
describe("a mapped node re-runs the call it was made from", () => {
  function run(spec: NonNullable<ReturnType<typeof flowNodeFor>>, inputs: Record<string, unknown> = {}) {
    const node: SimpleNode = { id: "n1", type: spec.type, data: { ...spec.data } }
    return buildPayload(node, "job1", inputs, "usage1").payload as Record<string, unknown>
  }

  it("generate_image", () => {
    const body = { prompt: "a lighthouse at dusk", provider: "nano-banana-pro", aspectRatio: "16:9", resolution: "2K", negativePrompt: "blurry" }
    const payload = run(nodeFor("/v1/generate-image", { ...TRANSPORT, ...body })!)
    expect(payload.provider).toBe(body.provider)
    expect(payload.aspectRatio).toBe(body.aspectRatio)
    expect(payload.resolution).toBe(body.resolution)
    expect(String(payload.prompt)).toContain(body.prompt)
  })

  it("modify_image", () => {
    const body = { imageUrl: IMG, prompt: "make it night", provider: "nano-banana-edit", aspectRatio: "1:1" }
    const payload = run(nodeFor("/v1/image-to-image", { ...TRANSPORT, ...body })!, { imageUrl: IMG, referenceImageUrls: [IMG] })
    expect(payload.provider).toBe(body.provider)
    expect(String(payload.prompt)).toContain(body.prompt)
  })

  it("generate_video (image to video)", () => {
    const body = { imageUrl: IMG, prompt: "the dolphins jump", provider: "grok-i2v", duration: 6, aspectRatio: "16:9" }
    const payload = run(nodeFor("/v1/generate-video", { ...TRANSPORT, ...body })!, { startFrameUrl: IMG, imageUrl: IMG })
    expect(payload.provider).toBe(body.provider)
    expect(payload.duration).toBe(body.duration)
    expect(String(payload.prompt)).toContain(body.prompt)
  })
})
