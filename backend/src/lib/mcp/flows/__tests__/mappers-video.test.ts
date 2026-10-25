import { describe, expect, it } from "vitest"
import { buildPayload } from "../../../../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../../../../services/workflow-engine/types.js"
import { outputHandleOf, placeFlowNode } from "../flow-graph.js"
import { flowNodeFor } from "../node-mappers.js"

/** The tool each video route is called by. */
const TOOL: Record<string, string> = {
  "/v1/extend-video": "extend_video",
  "/v1/video-upscale": "video_upscale",
  "/v1/trim-video": "trim_video",
  "/v1/loop-video": "loop_video",
  "/v1/merge-video-audio": "merge_video_audio",
  "/v1/combine-videos": "combine_videos",
  "/v1/add-captions": "add_captions",
  "/v1/motion-transfer": "motion_transfer",
  "/v1/face-swap": "face_swap",
  "/v1/lip-sync": "lip_sync",
  "/v1/gif-to-video": "gif_to_video",
  "/v1/video-to-video": "modify_video",
}

const TRANSPORT = { mcp_client: "Claude", userId: "u1" }
const VIDEO = "https://media.nodaro.ai/videos/11111111-2222-3333-4444-555555555555.mp4"
const VIDEO_2 = "https://media.nodaro.ai/videos/22222222-2222-3333-4444-555555555555.mp4"
const VIDEO_3 = "https://media.nodaro.ai/videos/33333333-2222-3333-4444-555555555555.mp4"
const IMAGE = "https://media.nodaro.ai/images/44444444-2222-3333-4444-555555555555.png"
const AUDIO = "https://media.nodaro.ai/audios/55555555-2222-3333-4444-555555555555.mp3"
const GIF = "https://media.nodaro.ai/uploads/dance.gif"

function nodeFor(route: string, body: Record<string, unknown>) {
  const spec = flowNodeFor(route, { ...TRANSPORT, ...body }, TOOL[route])
  return spec
}

/** The node built from the call, run by the server engine with the inputs its wires resolve to. */
function run(route: string, body: Record<string, unknown>, inputs: ResolvedInputs = {}) {
  const spec = nodeFor(route, body)
  if (!spec) throw new Error(`no node for ${route}`)
  const node: SimpleNode = { id: "n1", type: spec.type, data: { ...spec.data } }
  return buildPayload(node, "job1", inputs, "usage1").payload as Record<string, unknown>
}

const wires = (route: string, body: Record<string, unknown>) =>
  nodeFor(route, body)?.inputs.map((i) => [i.url, i.kind, i.targetHandle])

describe("a mapped video node re-runs the call it was made from", () => {
  it("extend_video, Seedance 2: the video by URL", () => {
    const body = { videoUrl: VIDEO, prompt: "the car drives off", provider: "seedance-2-extend", duration: 8, resolution: "720p", generateAudio: true }
    expect(wires("/v1/extend-video", body)).toEqual([[VIDEO, "video", "video"]])
    const payload = run("/v1/extend-video", body, { videoUrl: VIDEO })
    expect(payload).toMatchObject({ provider: "seedance-2-extend", video: VIDEO, duration: 8, resolution: "720p", generateAudio: true })
    expect(String(payload.prompt)).toContain(body.prompt)
  })

  it("extend_video, VEO and Runway: the prior task", () => {
    const veo = { taskId: "veo-task-1", prompt: "keep walking", provider: "veo-extend", model: "quality", seeds: 12345 }
    expect(nodeFor("/v1/extend-video", veo)?.inputs).toEqual([])
    expect(run("/v1/extend-video", veo)).toMatchObject({ kieTaskId: "veo-task-1", provider: "veo-extend", model: "quality", seeds: 12345, prompt: "keep walking" })
    const runway = { taskId: "rw-1", prompt: "pan left", provider: "runway-extend", quality: "1080p" }
    expect(run("/v1/extend-video", runway)).toMatchObject({ kieTaskId: "rw-1", provider: "runway-extend", quality: "1080p" })
  })

  it("video_upscale: Topaz upscales the wired video, VEO and the draft finalize name their task", () => {
    const topaz = { provider: "topaz", upscaleFactor: "4", videoUrl: VIDEO }
    expect(wires("/v1/video-upscale", topaz)).toEqual([[VIDEO, "video", "video"]])
    expect(run("/v1/video-upscale", topaz, { videoUrl: VIDEO })).toMatchObject({ provider: "topaz", upscaleFactor: "4", videoUrl: VIDEO })
    expect(run("/v1/video-upscale", { provider: "veo-1080p", upscaleFactor: "2", taskId: "veo-1" })).toMatchObject({ provider: "veo-1080p", kieTaskId: "veo-1" })
    expect(run("/v1/video-upscale", { provider: "seedance-2-5-hd", taskId: "draft-1" })).toMatchObject({ provider: "seedance-2-5-hd", kieTaskId: "draft-1" })
  })

  it("trim_video, in each of its three modes", () => {
    const time = run("/v1/trim-video", { videoUrl: VIDEO, outputSilentVideo: true, startTime: 1.5, endTime: 4 }, { videoUrl: VIDEO })
    expect(time).toMatchObject({ videoUrl: VIDEO, startTime: 1.5, endTime: 4, outputSilentVideo: true, smartLoopCut: false })
    const frames = run("/v1/trim-video", { videoUrl: VIDEO, outputSilentVideo: false, trimStartFrames: 2, trimEndFrames: 3 }, { videoUrl: VIDEO })
    expect(frames).toMatchObject({ trimStartFrames: 2, trimEndFrames: 3, startTime: 0, endTime: undefined, smartLoopCut: false })
    const smart = run("/v1/trim-video", { videoUrl: VIDEO, outputSilentVideo: false, smartLoopCut: true, smartLoopCutLookback: 24 }, { videoUrl: VIDEO })
    expect(smart).toMatchObject({ smartLoopCut: true, smartLoopCutLookback: 24, endTime: undefined, trimStartFrames: undefined })
    expect(wires("/v1/trim-video", { videoUrl: VIDEO, startTime: 0, endTime: 1 })).toEqual([[VIDEO, "video", "in"]])
  })

  it("loop_video: repeat N times, or loop to a length", () => {
    const repeat = run("/v1/loop-video", { videoUrl: VIDEO, mode: "repeat", repeatCount: 3, smartLoopCutBeforeRepeat: true, smartLoopCutLookback: 20 }, { videoUrl: VIDEO })
    expect(repeat).toMatchObject({ videoUrl: VIDEO, mode: "repeat", repeatCount: 3, smartLoopCutBeforeRepeat: true, smartLoopCutLookback: 20 })
    const duration = run("/v1/loop-video", { videoUrl: VIDEO, mode: "duration", targetDuration: 30 }, { videoUrl: VIDEO })
    expect(duration).toMatchObject({ mode: "duration", targetDuration: 30, repeatCount: undefined })
  })

  it("merge_video_audio: one track, at the volumes the call sent (or the route's defaults)", () => {
    const body = { videoUrl: VIDEO, audioUrl: AUDIO, voiceoverVolume: 80, backgroundVolume: 20, keepOriginalAudio: false }
    expect(wires("/v1/merge-video-audio", body)).toEqual([[VIDEO, "video", "in"], [AUDIO, "audio", "in"]])
    // Both wires land on `in`: the video becomes `videoUrl`, the upload an audio source.
    const resolved = { videoUrl: VIDEO, audioSources: [{ url: AUDIO, sourceNodeId: "mcp-in-audio" }] }
    const payload = run("/v1/merge-video-audio", body, resolved)
    expect(payload).toMatchObject({ videoUrl: VIDEO, voiceoverVolume: 80, backgroundVolume: 20, keepOriginalAudio: false })
    expect(payload.audioTracks).toEqual([{ url: AUDIO, startTime: 0, volume: 80 }])
    // The route's defaults when the call sent none.
    expect(run("/v1/merge-video-audio", { videoUrl: VIDEO, audioUrl: AUDIO }, resolved))
      .toMatchObject({ voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: true })
  })

  it("combine_videos: the clips in play order, with the call's levers", () => {
    const body = {
      videoUrls: [VIDEO, VIDEO_2, VIDEO_3], transition: "fade", transitionDuration: 1, audioMode: "keep",
      smartCutEnabled: true, smartCutMode: "preroll-keep-next", smartCutFramesPrev: 10, smartCutFramesNext: 12, trimStartFrames: 0, trimEndFrames: 4,
    }
    const payload = run("/v1/combine-videos", body, { videoUrls: [VIDEO, VIDEO_2, VIDEO_3] })
    expect(payload).toMatchObject({
      videoUrls: [VIDEO, VIDEO_2, VIDEO_3], transition: "fade", transitionDuration: 1, audioMode: "keep",
      smartCutEnabled: true, smartCutMode: "preroll-keep-next", smartCutFramesPrev: 10, smartCutFramesNext: 12, trimStartFrames: 0, trimEndFrames: 4,
    })
    // The route's defaults when the call sent none; the audio crossfade follows the transition.
    const bare = run("/v1/combine-videos", { videoUrls: [VIDEO, VIDEO_2] }, { videoUrls: [VIDEO, VIDEO_2] })
    expect(bare).toMatchObject({ transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", trimStartFrames: 1, trimEndFrames: 2, smartCutEnabled: false })
    expect(bare.audioCrossfadeDuration).toBeUndefined()
  })

  it("combine_videos: the wires are written in play order", () => {
    const spec = nodeFor("/v1/combine-videos", { videoUrls: [VIDEO_3, VIDEO, VIDEO_2] })!
    const placed = placeFlowNode([], "n1", spec, { ...spec.data })
    const sourceUrl = (id: unknown) => placed.upsertNodes.find((n) => n.id === id)?.data?.url
    expect(placed.upsertEdges.map((e) => sourceUrl(e.source))).toEqual([VIDEO_3, VIDEO, VIDEO_2])
  })

  it("add_captions: the text and every lever the call set", () => {
    const body = {
      videoUrl: VIDEO, text: "Hello there", style: "tiktok-words", position: "center", fontSize: 48, color: "#ffee00",
      look: "outline", fontFamily: "Rubik", fontWeight: 800, strokeColor: "#000000", strokeWidth: 6, highlightColor: "#ff0000",
      uppercase: true, positionY: 65, animate: false, maxWordsPerLine: 2, auto_transcribe: false, transcribe_provider: "whisper",
    }
    expect(wires("/v1/add-captions", body)).toEqual([[VIDEO, "video", "in"]])
    const payload = run("/v1/add-captions", body, { videoUrl: VIDEO })
    expect(payload).toMatchObject({
      videoUrl: VIDEO, text: "Hello there", style: "tiktok-words", position: "center", fontSize: 48, color: "#ffee00",
      look: "outline", fontFamily: "Rubik", fontWeight: 800, strokeColor: "#000000", strokeWidth: 6, highlightColor: "#ff0000",
      uppercase: true, positionY: 65, animate: false, maxWordsPerLine: 2, auto_transcribe: false, transcribe_provider: "whisper",
    })
  })

  it("add_captions: timed captions or segments make no node (the editor's Run sends neither); defaults when unset", () => {
    const captions = [{ text: "Hi", startMs: 0, endMs: 500, timestampMs: null, confidence: null }]
    const segments = [{ startMs: 0, endMs: 2000, style: "karaoke", text: "First part" }]
    expect(flowNodeFor("/v1/add-captions", { videoUrl: VIDEO, captions }, "add_captions")).toBeNull()
    expect(flowNodeFor("/v1/add-captions", { videoUrl: VIDEO, segments }, "add_captions")).toBeNull()
    const payload = run("/v1/add-captions", { videoUrl: VIDEO, auto_transcribe: true }, { videoUrl: VIDEO })
    expect(payload).toMatchObject({ style: "subtitle", position: "bottom", fontSize: 32, color: "white" })
  })

  it("motion_transfer: the character image and the driving video", () => {
    const body = { imageUrl: IMAGE, videoUrl: VIDEO, prompt: "dance", provider: "kling-3.0", resolution: "1080p", characterOrientation: "image", backgroundSource: "input_image", videoDuration: 8 }
    expect(wires("/v1/motion-transfer", body)).toEqual([[IMAGE, "image", "image"], [VIDEO, "video", "video"]])
    const payload = run("/v1/motion-transfer", body, { imageUrl: IMAGE, videoUrl: VIDEO })
    expect(payload).toMatchObject({ imageUrl: IMAGE, videoUrl: VIDEO, provider: "kling-3.0", resolution: "1080p", characterOrientation: "image", backgroundSource: "input_image", videoDuration: 8 })
    expect(String(payload.prompt)).toContain("dance")
  })

  it("face_swap: the face on `face`, the video on `video`", () => {
    const body = { videoUrl: VIDEO, faceImageUrl: IMAGE, provider: "roop" }
    expect(wires("/v1/face-swap", body)).toEqual([[IMAGE, "image", "face"], [VIDEO, "video", "video"]])
    expect(run("/v1/face-swap", body, { faceImageUrl: IMAGE, videoUrl: VIDEO })).toMatchObject({ faceImageUrl: IMAGE, videoUrl: VIDEO, provider: "roop" })
  })

  it("lip_sync: a portrait and a voice, with the call's levers", () => {
    const body = { imageUrl: IMAGE, audioUrl: AUDIO, provider: "kling-avatar", audioDurationSec: 7.3, prompt: "a calm presenter", resolution: "720p", seed: 7 }
    expect(wires("/v1/lip-sync", body)).toEqual([[IMAGE, "image", "image"], [AUDIO, "audio", "audio"]])
    const payload = run("/v1/lip-sync", body, { imageUrl: IMAGE, audioUrl: AUDIO })
    expect(payload).toMatchObject({ imageUrl: IMAGE, audioUrl: AUDIO, provider: "kling-avatar", audioDurationSec: 7.3, resolution: "720p", seed: 7 })
    expect(String(payload.prompt)).toContain("a calm presenter")
  })

  it("lip_sync: a video dub with its toggles", () => {
    const body = { videoUrl: VIDEO, audioUrl: AUDIO, provider: "volcengine-lipsync", mode: "basic", separateVocal: true, openScenedet: true, templStartSeconds: 2 }
    expect(wires("/v1/lip-sync", body)).toEqual([[VIDEO, "video", "video"], [AUDIO, "audio", "audio"]])
    expect(run("/v1/lip-sync", body, { videoUrl: VIDEO, audioUrl: AUDIO }))
      .toMatchObject({ videoUrl: VIDEO, audioUrl: AUDIO, provider: "volcengine-lipsync", mode: "basic", separateVocal: true, openScenedet: true, templStartSeconds: 2 })
  })

  it("gif_to_video: the GIF wired as an image, the route's defaults when unset", () => {
    const body = { gifUrl: GIF, loopToMinimum: false, targetDuration: 5, interpolate: false, alphaBackground: "black" }
    expect(wires("/v1/gif-to-video", body)).toEqual([[GIF, "image", "image"]])
    expect(run("/v1/gif-to-video", body, { imageUrl: GIF })).toMatchObject({ gifUrl: GIF, loopToMinimum: false, targetDuration: 5, interpolate: false, alphaBackground: "black" })
    expect(run("/v1/gif-to-video", { gifUrl: GIF }, { imageUrl: GIF })).toMatchObject({ loopToMinimum: true, targetDuration: 3, interpolate: true, alphaBackground: "white" })
  })

  it("gif_to_video: a later node is wired from its real output handle", () => {
    expect(outputHandleOf("gif-to-video")).toBe("video")
  })

  it("modify_video (video-to-video): length and resolution on the node's own fields", () => {
    const body = { videoUrl: VIDEO, prompt: "make it snowy", provider: "wan-flash", duration: "10", resolution: "1080p", audio: true, multiShots: true, seed: 42 }
    expect(wires("/v1/video-to-video", body)).toEqual([[VIDEO, "video", "video"]])
    const payload = run("/v1/video-to-video", body, { videoUrl: VIDEO })
    expect(payload).toMatchObject({ videoUrl: VIDEO, provider: "wan-flash", duration: "10", resolution: "1080p", audio: true, multiShots: true, seed: 42 })
    expect(String(payload.prompt)).toContain("make it snowy")
    const aleph = run("/v1/video-to-video", { videoUrl: VIDEO, prompt: "noir", provider: "runway-aleph", aspectRatio: "21:9" }, { videoUrl: VIDEO })
    expect(aleph).toMatchObject({ provider: "runway-aleph", aspectRatio: "21:9" })
  })
})

describe("a video call the node cannot reproduce maps to no node", () => {
  it.each([
    ["/v1/extend-video", { videoUrl: VIDEO, prompt: "x", provider: "seedance-2-extend", referenceImageUrls: [IMAGE] }],
    ["/v1/extend-video", { prompt: "x", provider: "veo-extend" }],
    ["/v1/video-upscale", { provider: "seedance-2-5-hd", sourceJobId: "job-1" }],
    ["/v1/merge-video-audio", { videoUrl: VIDEO, audioTracks: [{ url: AUDIO, startTime: 2 }] }],
    ["/v1/combine-videos", { videoUrls: [VIDEO, VIDEO_2, VIDEO] }],
    ["/v1/add-captions", { videoUrl: VIDEO, text: "x", captions: [{ text: "x", startMs: 0, endMs: 1 }] }],
    ["/v1/lip-sync", { imageUrl: IMAGE, audioUrl: AUDIO, provider: "omnihuman-1.5", fastMode: true }],
    ["/v1/video-to-video", { videoUrl: VIDEO, prompt: "x", provider: "runway-aleph", referenceImageUrl: IMAGE }],
    ["/v1/video-to-video", { videoUrl: VIDEO, prompt: "x", provider: "seedance-2-5" }],
    ["/v1/trim-video", { videoUrl: VIDEO, startTime: 1 }],
  ])("%s %j", (route, body) => {
    expect(nodeFor(route, body)).toBeNull()
  })

  it("a Seedance edit through modify_video is not a Generate Video node", () => {
    expect(flowNodeFor("/v1/text-to-video", { prompt: "x", provider: "seedance-2-5" }, "modify_video")).toBeNull()
  })
})
