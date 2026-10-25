import { isSeedanceVideoEditProvider } from "@nodaro/shared/models"
import { bool, defined, inputsOf, num, str, urls, type Body, type FlowNodeSpec, type RouteMapper, type RouteMappers } from "./kit.js"

/** `loopTrim`: the route takes a Loop trim (the text-to-video route drops one, so its node must not keep it). */
const generateVideo = (tools: readonly string[], { loopTrim = false } = {}): RouteMapper => ({
  tools,
  fields: new Set([
    "prompt", "provider", "duration", "aspectRatio", "resolution", "sound", "generateAudio",
    "negativePrompt", "seed", "draft", "keepOriginalSound",
    "imageUrl", "endFrameUrl", "referenceImageUrls", "referenceVideoUrls", "referenceAudioUrls",
    ...(loopTrim ? ["loopTrim"] : []),
  ]),
  map(body) {
    const provider = str(body.provider)
    if (!provider) return null
    const prompt = str(body.prompt)
    const start = str(body.imageUrl)
    const end = str(body.endFrameUrl)
    return {
      type: "generate-video",
      outputKey: "generatedVideoUrl",
      prompt,
      inputs: [
        ...(start ? inputsOf("image", "startFrame", [start]) : []),
        ...(end ? inputsOf("image", "endFrame", [end]) : []),
        ...inputsOf("image", "imageReferences", urls(body.referenceImageUrls)),
        ...inputsOf("video", "videoReferences", urls(body.referenceVideoUrls)),
        ...inputsOf("audio", "audioReferences", urls(body.referenceAudioUrls)),
      ],
      data: defined({
        label: "Generate Video",
        prompt,
        provider,
        duration: num(body.duration),
        aspectRatio: str(body.aspectRatio),
        resolution: str(body.resolution),
        sound: bool(body.sound),
        generateAudio: bool(body.generateAudio),
        negativePrompt: str(body.negativePrompt),
        seed: num(body.seed),
        draft: body.draft === true ? true : undefined,
        keepOriginalSound: bool(body.keepOriginalSound),
        loopTrim: loopTrimOf(body.loopTrim),
        fieldMappings: {},
      }),
    }
  },
})

/** The node's Loop trim (the smart-loop-cut after the generation), as the route takes it. */
function loopTrimOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Body
  const enabled = bool(record.enabled)
  if (enabled === undefined) return undefined
  const quality = str(record.quality)
  const frames = num(record.framesToTest)
  return defined({
    enabled,
    // The route's range: a whole number of frames, 1 to 64.
    framesToTest: frames !== undefined && Number.isInteger(frames) && frames >= 1 && frames <= 64 ? frames : undefined,
    quality: quality === "lossless" || quality === "precise" ? quality : undefined,
  })
}

/** A node whose one input is the video it works on (handle `handle`), and whose result is a video. */
function videoNode(type: string, handle: string, videoUrl: string, data: Record<string, unknown>, prompt?: string): FlowNodeSpec {
  return {
    type,
    outputKey: "generatedVideoUrl",
    prompt,
    inputs: inputsOf("video", handle, [videoUrl]),
    data: defined({ ...data, fieldMappings: {} }),
  }
}

/**
 * Extend Video. Seedance 2 extends the video by URL (wired on `video`); VEO and
 * Runway continue their own task, which the node holds as `kieTaskId`. The
 * verb's reference images have no place on the node: such a call is no node.
 */
const extendVideo: RouteMapper = {
  tools: ["extend_video"],
  fields: new Set(["videoUrl", "prompt", "provider", "duration", "resolution", "generateAudio", "taskId", "model", "seeds", "quality"]),
  map(body) {
    const provider = str(body.provider)
    const prompt = str(body.prompt)
    if (!provider || !prompt) return null
    const base = { label: "Extend Video", provider, prompt, negativePrompt: "" }
    if (provider === "seedance-2-extend") {
      const videoUrl = str(body.videoUrl)
      if (!videoUrl || body.taskId !== undefined) return null
      return videoNode("extend-video", "video", videoUrl, {
        ...base,
        duration: num(body.duration),
        resolution: str(body.resolution),
        generateAudio: bool(body.generateAudio),
      }, prompt)
    }
    const taskId = str(body.taskId)
    if ((provider !== "veo-extend" && provider !== "runway-extend") || !taskId || body.videoUrl !== undefined) return null
    return {
      type: "extend-video",
      outputKey: "generatedVideoUrl",
      prompt,
      inputs: [],
      data: defined({
        ...base,
        kieTaskId: taskId,
        model: str(body.model),
        seeds: num(body.seeds),
        quality: str(body.quality),
        fieldMappings: {},
      }),
    }
  },
}

/**
 * Upscale Video. Topaz upscales the wired video; VEO and the Seedance draft
 * finalize re-render a task, which the node holds as `kieTaskId`. A draft named
 * by its job id (`sourceJobId`) has no field on the node: that call is no node.
 */
const videoUpscale: RouteMapper = {
  tools: ["video_upscale"],
  fields: new Set(["provider", "upscaleFactor", "targetResolution", "targetFps", "videoUrl", "taskId"]),
  map(body) {
    const provider = str(body.provider) ?? "topaz"
    const videoUrl = str(body.videoUrl)
    const taskId = str(body.taskId)
    if (!videoUrl && !taskId) return null
    const targetResolution = str(body.targetResolution)
    const data = {
      label: "Upscale Video",
      provider,
      // Topaz's target as sent; a legacy factor only without a resolution.
      targetResolution,
      targetFps: typeof body.targetFps === "number" ? body.targetFps : undefined,
      upscaleFactor: targetResolution ? undefined : str(body.upscaleFactor),
      kieTaskId: taskId,
    }
    if (videoUrl) return videoNode("video-upscale", "video", videoUrl, data)
    return { type: "video-upscale", outputKey: "generatedVideoUrl", inputs: [], data: defined({ ...data, fieldMappings: {} }) }
  },
}

/** Trim Video, in the one mode the call used: a smart loop cut, frames, or a time range. */
const trimVideo: RouteMapper = {
  tools: ["trim_video"],
  fields: new Set(["videoUrl", "outputSilentVideo", "smartLoopCut", "smartLoopCutLookback", "trimStartFrames", "trimEndFrames", "startTime", "endTime"]),
  map(body) {
    const videoUrl = str(body.videoUrl)
    if (!videoUrl) return null
    const base = { label: "Trim Video", outputSilentVideo: bool(body.outputSilentVideo) ?? false }
    if (body.smartLoopCut === true) {
      return videoNode("trim-video", "in", videoUrl, { ...base, trimMode: "smart-loop-cut", startTime: 0, endTime: 0, smartLoopCutLookback: num(body.smartLoopCutLookback) })
    }
    const startFrames = num(body.trimStartFrames)
    const endFrames = num(body.trimEndFrames)
    if (startFrames !== undefined || endFrames !== undefined) {
      return videoNode("trim-video", "in", videoUrl, { ...base, trimMode: "frames", startTime: 0, endTime: 0, trimStartFrames: startFrames, trimEndFrames: endFrames })
    }
    const startTime = num(body.startTime)
    const endTime = num(body.endTime)
    if (startTime === undefined || endTime === undefined) return null
    return videoNode("trim-video", "in", videoUrl, { ...base, trimMode: "time", startTime, endTime })
  },
}

/** Loop Video: repeat N times, or loop to a length. */
const loopVideo: RouteMapper = {
  tools: ["loop_video"],
  fields: new Set(["videoUrl", "mode", "repeatCount", "targetDuration", "smartLoopCutBeforeRepeat", "smartLoopCutLookback"]),
  map(body) {
    const videoUrl = str(body.videoUrl)
    const mode = body.mode === "repeat" || body.mode === "duration" ? body.mode : undefined
    if (!videoUrl || !mode) return null
    return videoNode("loop-video", "in", videoUrl, {
      label: "Loop Video",
      mode,
      repeatCount: mode === "repeat" ? num(body.repeatCount) : undefined,
      targetDuration: mode === "duration" ? num(body.targetDuration) : undefined,
      smartLoopCutBeforeRepeat: bool(body.smartLoopCutBeforeRepeat),
      smartLoopCutLookback: num(body.smartLoopCutLookback),
    })
  },
}

/**
 * Merge Video & Audio with ONE audio track. Several tracks carry a start and a
 * volume each, which the node keeps per source node (`trackSettings`): no node.
 * The route's defaults are written out, because the node's Run never meets them.
 */
const mergeVideoAudio: RouteMapper = {
  tools: ["merge_video_audio"],
  fields: new Set(["videoUrl", "audioUrl", "voiceoverVolume", "backgroundVolume", "keepOriginalAudio"]),
  map(body) {
    const videoUrl = str(body.videoUrl)
    const audioUrl = str(body.audioUrl)
    if (!videoUrl || !audioUrl || videoUrl === audioUrl) return null
    const backgroundVolume = num(body.backgroundVolume) ?? 30
    return {
      type: "merge-video-audio",
      outputKey: "generatedVideoUrl",
      inputs: [...inputsOf("video", "in", [videoUrl]), ...inputsOf("audio", "in", [audioUrl])],
      data: {
        label: "Merge Video & Audio",
        audioType: "voiceover",
        voiceoverVolume: num(body.voiceoverVolume) ?? 100,
        // The node's panel and both Runs read the video's own sound level as `originalAudioVolume`.
        originalAudioVolume: backgroundVolume,
        backgroundVolume,
        keepOriginalAudio: bool(body.keepOriginalAudio) ?? true,
        trackSettings: {},
        fieldMappings: {},
      },
    }
  },
}

/**
 * Combine Videos, the clips wired in play order. A clip used twice would be
 * one wire (an input is one edge per URL), so the Run would join fewer clips:
 * no node.
 */
const combineVideos: RouteMapper = {
  tools: ["combine_videos"],
  fields: new Set([
    "videoUrls", "transition", "transitionDuration", "audioMode", "audioCrossfadeCurve", "audioCrossfadeDuration",
    "smartCutEnabled", "smartCutMode", "smartCutFramesPrev", "smartCutFramesNext", "trimStartFrames", "trimEndFrames",
  ]),
  map(body) {
    const videoUrls = urls(body.videoUrls)
    if (videoUrls.length < 2 || new Set(videoUrls).size !== videoUrls.length) return null
    return {
      type: "combine-videos",
      outputKey: "generatedVideoUrl",
      inputs: inputsOf("video", "in", videoUrls),
      data: defined({
        label: "Combine Videos",
        transition: str(body.transition) ?? "cut",
        transitionDuration: num(body.transitionDuration) ?? 0.5,
        audioMode: str(body.audioMode) ?? "crossfade",
        audioCrossfadeCurve: str(body.audioCrossfadeCurve),
        audioCrossfadeDuration: num(body.audioCrossfadeDuration),
        smartCutEnabled: bool(body.smartCutEnabled),
        smartCutMode: str(body.smartCutMode),
        smartCutFramesPrev: num(body.smartCutFramesPrev),
        smartCutFramesNext: num(body.smartCutFramesNext),
        trimStartFrames: num(body.trimStartFrames),
        trimEndFrames: num(body.trimEndFrames),
        fieldMappings: {},
      }),
    }
  },
}

/** The add_captions levers the node holds under the same name. */
const CAPTION_LEVERS = [
  "fontSize", "color", "backgroundColor", "look", "fontFamily", "fontWeight", "strokeColor", "strokeWidth",
  "highlightColor", "uppercase", "positionY", "animate", "maxWordsPerLine",
] as const

/**
 * Add Captions. The node keeps the levers in their route names, except the two
 * transcription switches (camelCase on the node). The route's defaults for the
 * four base levers are written out: the node's Run never meets the route's Zod.
 */
const addCaptions: RouteMapper = {
  tools: ["add_captions"],
  fields: new Set(["videoUrl", "text", "captions", "auto_transcribe", "transcribe_provider", "style", "position", "segments", ...CAPTION_LEVERS]),
  map(body) {
    const videoUrl = str(body.videoUrl)
    if (!videoUrl) return null
    const captions = Array.isArray(body.captions) && body.captions.length > 0 ? body.captions : undefined
    // The editor's Run sends the node's text (or transcribes), never timed captions or
    // segments: a call carrying them is a node whose Run would caption something else.
    if (captions || (Array.isArray(body.segments) && body.segments.length > 0)) return null
    const levers = Object.fromEntries(CAPTION_LEVERS.map((key) => [key, body[key]]))
    const text = str(body.text)
    return videoNode("add-captions", "in", videoUrl, {
      label: "Add Captions",
      ...levers,
      style: str(body.style) ?? "subtitle",
      position: str(body.position) ?? "bottom",
      fontSize: num(body.fontSize) ?? 32,
      color: str(body.color) ?? "white",
      text,
      captions,
      autoTranscribe: bool(body.auto_transcribe),
      transcribeProvider: str(body.transcribe_provider),
      segments: Array.isArray(body.segments) && body.segments.length > 0 ? body.segments : undefined,
    }, text)
  },
}

/** Motion Transfer: the character image on `image`, the driving video on `video`. */
const motionTransfer: RouteMapper = {
  tools: ["motion_transfer"],
  fields: new Set(["imageUrl", "videoUrl", "prompt", "provider", "resolution", "characterOrientation", "backgroundSource", "videoDuration"]),
  map(body) {
    const imageUrl = str(body.imageUrl)
    const videoUrl = str(body.videoUrl)
    if (!imageUrl || !videoUrl) return null
    const prompt = str(body.prompt)
    return {
      type: "motion-transfer",
      outputKey: "generatedVideoUrl",
      prompt,
      inputs: [...inputsOf("image", "image", [imageUrl]), ...inputsOf("video", "video", [videoUrl])],
      data: defined({
        label: "Motion Transfer",
        prompt: prompt ?? "",
        negativePrompt: "",
        provider: str(body.provider) ?? "kling",
        resolution: str(body.resolution) ?? "720p",
        // Always written: the node's own default ("video") is not the route's ("image").
        characterOrientation: str(body.characterOrientation) ?? "image",
        backgroundSource: str(body.backgroundSource),
        videoDuration: num(body.videoDuration),
        fieldMappings: {},
      }),
    }
  },
}

/** Face Swap: the face photo on `face`, the video on `video`. */
const faceSwap: RouteMapper = {
  tools: ["face_swap"],
  fields: new Set(["videoUrl", "faceImageUrl", "provider"]),
  map(body) {
    const videoUrl = str(body.videoUrl)
    const faceImageUrl = str(body.faceImageUrl)
    if (!videoUrl || !faceImageUrl) return null
    return {
      type: "face-swap",
      outputKey: "generatedVideoUrl",
      inputs: [...inputsOf("image", "face", [faceImageUrl]), ...inputsOf("video", "video", [videoUrl])],
      data: { label: "Face Swap", provider: str(body.provider) ?? "roop", fieldMappings: {} },
    }
  },
}

/** The lip_sync levers the node holds under the same name (OmniHuman's `fastMode` is never sent by a Run). */
const LIP_SYNC_LEVERS = [
  "resolution", "audioDurationSec", "seed", "mode", "separateVocal", "openScenedet", "alignAudio", "alignAudioReverse", "templStartSeconds",
] as const

/** Lip Sync: the face (an image or a video) and the voice, each on its handle. */
const lipSync: RouteMapper = {
  tools: ["lip_sync"],
  fields: new Set(["imageUrl", "videoUrl", "audioUrl", "provider", "prompt", ...LIP_SYNC_LEVERS]),
  map(body) {
    const imageUrl = str(body.imageUrl)
    const videoUrl = str(body.videoUrl)
    const audioUrl = str(body.audioUrl)
    const provider = str(body.provider)
    if (!audioUrl || !provider || (!imageUrl && !videoUrl)) return null
    const prompt = str(body.prompt)
    return {
      type: "lip-sync",
      outputKey: "generatedVideoUrl",
      prompt,
      inputs: [
        ...(imageUrl ? inputsOf("image", "image", [imageUrl]) : []),
        ...(videoUrl ? inputsOf("video", "video", [videoUrl]) : []),
        ...inputsOf("audio", "audio", [audioUrl]),
      ],
      data: defined({
        label: "Lip Sync",
        provider,
        // A promptless call gets the provider's own wording: the editor's Run would
        // otherwise send its fallback ("talking", not "speaking") and differ.
        prompt: prompt ?? "A person speaking naturally",
        ...Object.fromEntries(LIP_SYNC_LEVERS.map((key) => [key, body[key]])),
        fieldMappings: {},
      }),
    }
  },
}

/** Gif to Video: the GIF wired on `image` (an uploaded .gif). */
const gifToVideo: RouteMapper = {
  tools: ["gif_to_video"],
  fields: new Set(["gifUrl", "loopToMinimum", "targetDuration", "interpolate", "alphaBackground"]),
  map(body) {
    const gifUrl = str(body.gifUrl)
    if (!gifUrl) return null
    // The route's defaults, written out: the node's Run never meets the route's Zod.
    return {
      type: "gif-to-video",
      outputKey: "generatedVideoUrl",
      inputs: inputsOf("image", "image", [gifUrl]),
      data: {
        label: "Gif to Video",
        loopToMinimum: bool(body.loopToMinimum) ?? true,
        targetDuration: num(body.targetDuration) ?? 3,
        interpolate: bool(body.interpolate) ?? true,
        alphaBackground: str(body.alphaBackground) ?? "white",
        fieldMappings: {},
      },
    }
  },
}

/**
 * Video to Video, the route's own models (a Seedance edit is dispatched as
 * text-to-video and is not this lane). The node keeps the length and the
 * resolution as `v2vDuration` / `v2vResolution`. Its reference-image handle
 * takes no wire for these models, so a call with `referenceImageUrl` is no node.
 */
const videoToVideo: RouteMapper = {
  tools: ["modify_video"],
  fields: new Set(["videoUrl", "prompt", "provider", "duration", "resolution", "aspectRatio", "audio", "multiShots", "seed"]),
  map(body: Body) {
    const videoUrl = str(body.videoUrl)
    const provider = str(body.provider) ?? "wan"
    if (!videoUrl || isSeedanceVideoEditProvider(provider)) return null
    const prompt = str(body.prompt) ?? ""
    return videoNode("video-to-video", "video", videoUrl, {
      label: "Video to Video",
      prompt,
      provider,
      duration: Number(str(body.duration) ?? 5),
      negativePrompt: "",
      v2vDuration: str(body.duration),
      v2vResolution: str(body.resolution),
      aspectRatio: str(body.aspectRatio),
      audio: bool(body.audio),
      multiShots: bool(body.multiShots),
      seed: num(body.seed),
    }, prompt)
  },
}

/** Video routes whose calls become nodes. Both video lanes are one Generate Video node. */
export const VIDEO_ROUTE_MAPPERS: RouteMappers = {
  "/v1/generate-video": generateVideo(["animate_image", "generate_video"], { loopTrim: true }),
  "/v1/text-to-video": generateVideo(["generate_video"]),
  "/v1/extend-video": extendVideo,
  "/v1/video-upscale": videoUpscale,
  "/v1/trim-video": trimVideo,
  "/v1/loop-video": loopVideo,
  "/v1/merge-video-audio": mergeVideoAudio,
  "/v1/combine-videos": combineVideos,
  "/v1/add-captions": addCaptions,
  "/v1/motion-transfer": motionTransfer,
  "/v1/face-swap": faceSwap,
  "/v1/lip-sync": lipSync,
  "/v1/gif-to-video": gifToVideo,
  "/v1/video-to-video": videoToVideo,
}
