/**
 * Build BullMQ job payloads for each node type from node data + resolved inputs.
 * Returns { jobName, queueName, payload } for worker-queued nodes.
 */

import type { SimpleNode, ResolvedInputs } from "./types.js"

interface PayloadResult {
  /** BullMQ job name (e.g., "generate-image") */
  jobName: string
  /** Queue to add to: "video-generation" or "video-render" */
  queueName: "video-generation" | "video-render"
  /** Job data payload */
  payload: Record<string, unknown>
  /** Model identifier for credit reservation */
  modelIdentifier: string
}

/**
 * Compute composite model identifier for variable credit pricing.
 */
const HIGH_QUALITY_PROVIDERS = new Set(["gpt-image", "gpt-image-i2i", "seedream"])
const TWO_K_RESOLUTION_PROVIDERS = new Set(["flux", "flux-pro-i2i", "flux-flex", "flux-i2i"])
const IDEOGRAM_PROVIDERS = new Set(["ideogram", "ideogram-edit", "ideogram-remix", "ideogram-reframe"])

export function buildCreditModelIdentifier(
  provider: string,
  quality?: string,
  resolution?: string,
): string {
  if (HIGH_QUALITY_PROVIDERS.has(provider) && quality === "high") {
    return `${provider}:high`
  }
  if (TWO_K_RESOLUTION_PROVIDERS.has(provider) && resolution === "2K") {
    return `${provider}:2K`
  }
  if (provider === "nano-banana-pro" && resolution === "4K") {
    return `${provider}:4K`
  }
  if (IDEOGRAM_PROVIDERS.has(provider)) {
    if (quality === "TURBO") return `${provider}:TURBO`
    if (quality === "QUALITY") return `${provider}:QUALITY`
  }
  return provider
}

/** Shorthand for FFmpeg nodes that all share queueName + modelIdentifier. */
function ffmpegResult(
  jobName: string,
  payload: Record<string, unknown>,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier: "ffmpeg",
    payload,
  }
}

/** Shorthand for nodes with a fixed model identifier and no provider selection. */
function simpleResult(
  jobName: string,
  modelIdentifier: string,
  payload: Record<string, unknown>,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier,
    payload,
  }
}

export function buildPayload(
  node: SimpleNode,
  jobId: string,
  resolvedInputs: ResolvedInputs,
  usageLogId?: string,
): PayloadResult {
  const data = node.data
  const type = node.type

  switch (type) {
    // --- Image generation ---
    case "generate-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(
          provider,
          data.quality as string | undefined,
          data.resolution as string | undefined,
        ),
        payload: {
          jobId,
          prompt: resolvedInputs.prompt || data.prompt,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          provider,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: data.negativePrompt,
          usageLogId,
        },
      }
    }

    case "edit-image": {
      const provider = (data.provider as string) ?? "recraft-remove-bg"
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          provider,
          usageLogId,
        },
      }
    }

    case "image-to-image": {
      const provider = (data.provider as string) ?? "flux-i2i"
      return {
        jobName: "image-to-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(
          provider,
          data.quality as string | undefined,
          data.resolution as string | undefined,
        ),
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          prompt: resolvedInputs.prompt || data.prompt,
          provider,
          strength: data.strength,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: data.negativePrompt,
          usageLogId,
        },
      }
    }

    // --- Video generation ---
    case "image-to-video": {
      const provider = (data.provider as string) ?? "kling"
      return {
        jobName: "image-to-video",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          endFrameUrl: resolvedInputs.endFrameUrl,
          audioUrl: resolvedInputs.audioUrl,
          prompt: resolvedInputs.prompt || data.prompt,
          provider,
          duration: data.duration,
          mode: data.mode,
          sound: data.sound,
          generateAudio: data.generateAudio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          usageLogId,
        },
      }
    }

    case "text-to-video": {
      const provider = (data.provider as string) ?? "kling"
      return {
        jobName: "text-to-video",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: resolvedInputs.prompt || data.prompt,
          provider,
          duration: data.duration,
          mode: data.mode,
          aspectRatio: data.aspectRatio,
          negativePrompt: data.negativePrompt,
          usageLogId,
        },
      }
    }

    case "video-to-video":
      return simpleResult("video-to-video", "wan", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        prompt: resolvedInputs.prompt || data.prompt,
        strength: data.strength,
        usageLogId,
      })

    case "lip-sync": {
      const provider = (data.provider as string) ?? "kling-avatar"
      return {
        jobName: "lip-sync",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || resolvedInputs.imageUrl || data.videoUrl,
          audioUrl: resolvedInputs.audioUrl || data.audioUrl,
          provider,
          usageLogId,
        },
      }
    }

    case "motion-transfer":
      return simpleResult("motion-transfer", "motion-transfer", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        imageUrl: resolvedInputs.imageUrl || data.imageUrl,
        usageLogId,
      })

    case "video-upscale":
      return simpleResult("video-upscale", "topaz-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        usageLogId,
      })

    // --- Audio ---
    case "text-to-speech": {
      const provider = (data.provider as string) ?? "elevenlabs-v3"
      return {
        jobName: "text-to-speech",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          text: resolvedInputs.prompt || data.text,
          voice: data.voice,
          provider,
          voiceType: data.voiceType,
          stability: data.stability,
          similarityBoost: data.similarityBoost,
          style: data.style,
          speed: data.speed,
          languageCode: data.languageCode,
          usageLogId,
        },
      }
    }

    case "generate-music": {
      const provider = (data.provider as string) ?? "suno-v4"
      return {
        jobName: "generate-music",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: resolvedInputs.prompt || data.prompt,
          provider,
          duration: data.duration,
          instrumental: data.instrumental,
          referenceAudioUrl: resolvedInputs.audioUrl,
          usageLogId,
        },
      }
    }

    case "text-to-audio":
      return simpleResult("text-to-audio", "elevenlabs-sfx", {
        jobId,
        text: resolvedInputs.prompt || data.text,
        duration: data.duration,
        usageLogId,
      })

    case "audio-isolation":
      return simpleResult("audio-isolation", "elevenlabs-isolation", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        usageLogId,
      })

    case "text-to-dialogue":
      return simpleResult("text-to-dialogue", "elevenlabs-dialogue", {
        jobId,
        script: data.script,
        usageLogId,
      })

    case "voice-changer":
      return simpleResult("voice-changer", "elevenlabs-voice-changer", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        voice: data.voice,
        usageLogId,
      })

    case "dubbing":
      return simpleResult("dubbing", "elevenlabs-dubbing", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        targetLanguage: data.targetLanguage,
        usageLogId,
      })

    case "voice-remix":
      return simpleResult("voice-remix", "elevenlabs-voice-remix", {
        jobId,
        voiceDescription: data.voiceDescription,
        text: resolvedInputs.prompt || data.text,
        usageLogId,
      })

    case "voice-design":
      return simpleResult("voice-design", "elevenlabs-voice-design", {
        jobId,
        text: resolvedInputs.prompt || data.text,
        model: data.model,
        loudness: data.loudness,
        guidanceScale: data.guidanceScale,
        seed: data.seed,
        quality: data.quality,
        shouldEnhance: data.shouldEnhance,
        usageLogId,
      })

    case "forced-alignment":
      return simpleResult("forced-alignment", "elevenlabs-forced-alignment", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        transcript: resolvedInputs.prompt || data.transcript,
        usageLogId,
      })

    // --- Suno ---
    case "suno-generate":
      return simpleResult("suno-generate", "suno-generate", {
        jobId,
        prompt: resolvedInputs.prompt || data.prompt,
        lyrics: data.lyrics,
        isCustom: data.isCustom,
        title: data.title,
        tags: data.tags,
        instrumental: data.instrumental,
        usageLogId,
      })

    case "suno-cover":
      return simpleResult("suno-cover", "suno-cover", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || resolvedInputs.uploadUrl || data.audioUrl,
        usageLogId,
      })

    case "suno-extend":
      return simpleResult("suno-extend", "suno-extend", {
        jobId,
        trackId: resolvedInputs.sunoTrackId || data.sunoTrackId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId,
        prompt: resolvedInputs.prompt || data.prompt,
        continueFrom: data.continueFrom,
        usageLogId,
      })

    case "suno-lyrics":
      return simpleResult("suno-lyrics", "suno-lyrics", {
        jobId,
        prompt: resolvedInputs.prompt || data.prompt,
        usageLogId,
      })

    case "suno-separate":
      return simpleResult("suno-separate", "suno-separate", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        usageLogId,
      })

    case "suno-music-video":
      return simpleResult("suno-music-video", "suno-music-video", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        imageUrl: resolvedInputs.imageUrl || data.imageUrl,
        usageLogId,
      })

    // --- Transcription / OCR ---
    case "transcribe": {
      const provider = (data.provider as string) ?? "elevenlabs-stt"
      return {
        jobName: "transcribe",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          audioUrl: resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl,
          provider,
          usageLogId,
        },
      }
    }

    // --- FFmpeg processing (0 credits) ---
    case "combine-videos":
      return ffmpegResult("combine-videos", {
        jobId,
        videoUrls: resolvedInputs.videoUrls || data.videoUrls || [],
        transition: data.transition ?? "cut",
        transitionDuration: data.transitionDuration ?? 0.5,
        audioMode: data.audioMode ?? "keep",
        usageLogId,
      })

    case "merge-video-audio":
      return ffmpegResult("merge-video-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        audioUrl: resolvedInputs.audioUrl,
        audioSources: resolvedInputs.audioSources,
        audioMode: data.audioMode ?? "replace",
        usageLogId,
      })

    case "extract-audio":
      return ffmpegResult("extract-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        usageLogId,
      })

    case "trim-video":
      return ffmpegResult("trim-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        startTime: data.startTime,
        endTime: data.endTime,
        usageLogId,
      })

    case "resize-video":
      return ffmpegResult("resize-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        width: data.width,
        height: data.height,
        aspectRatio: data.aspectRatio,
        usageLogId,
      })

    case "speed-ramp":
      return ffmpegResult("speed-ramp", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        speed: data.speed,
        usageLogId,
      })

    case "loop-video":
      return ffmpegResult("loop-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        loops: data.loops,
        usageLogId,
      })

    case "fade-video":
      return ffmpegResult("fade-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        fadeIn: data.fadeIn,
        fadeOut: data.fadeOut,
        usageLogId,
      })

    case "transcode-video":
      return ffmpegResult("transcode-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        format: data.format,
        codec: data.codec,
        usageLogId,
      })

    case "add-captions":
      return ffmpegResult("add-captions", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        captions: data.captions,
        style: data.captionStyle ?? data.style,
        position: data.captionPosition ?? data.position,
        usageLogId,
      })

    case "mix-audio":
      return ffmpegResult("mix-audio", {
        jobId,
        audioUrls: resolvedInputs.audioUrls || data.audioUrls || [],
        volumes: data.volumes,
        usageLogId,
      })

    case "adjust-volume":
      return ffmpegResult("adjust-volume", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl,
        volume: data.volume,
        usageLogId,
      })

    // --- Entity generation (character, face, object, location share identical structure) ---
    case "character":
    case "face":
    case "object":
    case "location": {
      const provider = (data.provider as string) ?? "nano-banana"
      return {
        jobName: `generate-${type}`,
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: data.description || data.prompt,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }

    case "scene": {
      const provider = (data.provider as string) ?? "nano-banana"
      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: resolvedInputs.prompt || data.prompt,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          aspectRatio: data.aspectRatio,
          usageLogId,
        },
      }
    }

    case "generate-script":
      return simpleResult("generate-script", "generate-script", {
        jobId,
        prompt: resolvedInputs.prompt || data.prompt,
        style: data.style,
        sceneCount: data.sceneCount,
        usageLogId,
      })

    // --- Render video (goes to render queue) ---
    case "render-video": {
      return {
        jobName: "render-video",
        queueName: "video-render",
        modelIdentifier: "render-video",
        payload: {
          jobId,
          // The plan/scene-graph is passed through resolved inputs or node data
          planType: data.planType,
          plan: data.plan,
          sceneGraph: data.sceneGraph,
          template: data.template,
          usageLogId,
        },
      }
    }

    default:
      throw new Error(`[payload-builder] Unknown node type: ${type}`)
  }
}
