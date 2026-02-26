/**
 * Build BullMQ job payloads for each node type from node data + resolved inputs.
 * Returns { jobName, queueName, payload } for worker-queued nodes.
 */

import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeExecutionState } from "./types.js"

// Models that support native negative_prompt parameter (not appended to prompt)
const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",
  "ideogram", "ideogram-remix",
  "qwen", "qwen-edit",
])

// Models that support reference image uploads
const MODELS_WITH_REFERENCE_IMAGE_SUPPORT = new Set([
  "nano-banana",
  "nano-banana-pro",
  "ideogram",
])

// ---------------------------------------------------------------------------
// Character definitions + prompt template types (from workflow settings)
// ---------------------------------------------------------------------------

export interface CharacterDefinition {
  id: string
  name: string
  type: "reference" | "description"
  category?: "character" | "face" | "location" | "object"
  referenceImageUrl?: string
  description?: string
}

export interface WorkflowSettings {
  characterDefinitions?: CharacterDefinition[]
  flowPromptTemplates?: Record<string, string>
}

/** Context passed to buildPayload for nodes that need workflow-level data. */
export interface PayloadBuildContext {
  settings?: WorkflowSettings
  nodes?: SimpleNode[]
  edges?: SimpleEdge[]
  nodeStates?: Record<string, NodeExecutionState>
}

// ---------------------------------------------------------------------------
// Default prompt templates (matching frontend SYSTEM_PROMPT_TEMPLATES)
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATES: Record<string, string> = {
  "character-description": "Include character '{name}': {description}.",
  "object-description": "Include object '{name}': {description}.",
  "location-description": "Include location '{name}': {description}.",
  "face-description":
    "Include the exact face and facial features of '{name}' from the reference image. Maintain perfect likeness and facial identity.",
  "generate-image-wrapper": "{userPrompt}\n{assetDescriptions}",
}

function resolveTemplate(
  key: string,
  userTemplates?: Record<string, string>,
  flowTemplates?: Record<string, string>,
): string {
  return flowTemplates?.[key] ?? userTemplates?.[key] ?? DEFAULT_TEMPLATES[key] ?? ""
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value || ""),
    template,
  )
}

// ---------------------------------------------------------------------------
// Ancestor reference image collection (matching frontend collectAncestorRefs)
// ---------------------------------------------------------------------------

const IMAGE_REF_TYPES = new Set([
  "upload-image", "face", "character", "object", "location",
  "generate-image", "edit-image", "image-to-image",
])

const PASSTHROUGH_TYPES = new Set([
  "ai-writer", "split-text", "combine-text", "text-prompt", "loop", "list",
])

function collectAncestorRefs(
  nodeId: string,
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  visited = new Set<string>(),
): string[] {
  if (visited.has(nodeId)) return []
  visited.add(nodeId)
  const refs: string[] = []
  const incoming = edges.filter((e) => e.target === nodeId)
  for (const edge of incoming) {
    const src = nodes.find((n) => n.id === edge.source)
    if (!src) continue
    if (IMAGE_REF_TYPES.has(src.type)) {
      const url = nodeStates[src.id]?.output?.imageUrl
      if (url?.trim()) refs.push(url.trim())
    }
    if (PASSTHROUGH_TYPES.has(src.type)) {
      refs.push(...collectAncestorRefs(src.id, nodes, edges, nodeStates, visited))
    }
  }
  return refs
}

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
  buildCtx?: PayloadBuildContext,
): PayloadResult {
  const data = node.data
  const type = node.type

  switch (type) {
    // --- Image generation ---
    case "generate-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      const settings = buildCtx?.settings

      // Collect reference images from all sources (matching frontend behavior)
      const chainRefs = resolvedInputs.referenceImageUrls
        ?? (resolvedInputs.imageUrl ? [resolvedInputs.imageUrl] : undefined)
      const extractedRefs = data.extractedReferenceUrls as string[] | undefined
      const nodeRefUrl = data.referenceImageUrl as string | undefined

      // Character definition refs + descriptions
      const charIds = (data.characterDefinitionIds as string[]) ?? []
      const charDefs = (settings?.characterDefinitions ?? []).filter(
        (c) => charIds.includes(c.id),
      )
      const charRefUrls = charDefs
        .filter((c) => c.type === "reference" && c.referenceImageUrl)
        .map((c) => c.referenceImageUrl as string)
      const flowTemplates = settings?.flowPromptTemplates
      const charDescs = charDefs
        .filter((c) => c.type === "description" && c.description)
        .map((c) => {
          const templateKey =
            c.category === "face" ? "face-description"
              : c.category === "location" ? "location-description"
                : c.category === "object" ? "object-description"
                  : "character-description"
          const template = resolveTemplate(templateKey, undefined, flowTemplates)
          return applyTemplate(template, {
            name: c.name,
            description: c.description || "",
          })
        })

      const refImages = [
        ...(nodeRefUrl ? [nodeRefUrl] : []),
        ...(chainRefs ?? []),
        ...(extractedRefs ?? []),
        ...charRefUrls,
      ]

      // Ancestor refs fallback (traverse upstream for image-producing nodes)
      if (refImages.length === 0 && buildCtx?.nodes && buildCtx?.edges && buildCtx?.nodeStates) {
        refImages.push(
          ...collectAncestorRefs(node.id, buildCtx.nodes, buildCtx.edges, buildCtx.nodeStates),
        )
      }

      // Build prompt
      let prompt = (resolvedInputs.prompt || (data.prompt as string) || "") as string
      // Wrap with character descriptions
      if (charDescs.length > 0) {
        const wrapperTemplate = resolveTemplate("generate-image-wrapper", undefined, flowTemplates)
        prompt = applyTemplate(wrapperTemplate, {
          userPrompt: prompt,
          assetDescriptions: charDescs.join(" "),
        })
      }
      // Append style to prompt (matching frontend behavior)
      const styleText = typeof data.style === "string" ? data.style.trim() : ""
      if (styleText) prompt += `\nStyle: ${styleText}`
      // Handle negative prompt: native support vs prompt-appended
      const negPrompt = typeof data.negativePrompt === "string" ? data.negativePrompt.trim() : ""
      let nativeNegativePrompt: string | undefined
      if (negPrompt) {
        if (NATIVE_NEGATIVE_PROMPT_MODELS.has(provider)) {
          nativeNegativePrompt = negPrompt
        } else {
          prompt += `\nAvoid: ${negPrompt}`
        }
      }
      if (prompt.length > 2000) prompt = prompt.slice(0, 1997) + "..."
      // Only send reference images for models that support them
      const supportsRefs = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(provider)
      const refsToSend = supportsRefs && refImages.length > 0 ? refImages : undefined
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
          prompt,
          referenceImageUrls: refsToSend,
          provider,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: nativeNegativePrompt,
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
          prompt: resolvedInputs.prompt || data.prompt,
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
          referenceImageUrls: resolvedInputs.referenceImageUrls,
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
          imageUrl: resolvedInputs.startFrameUrl || resolvedInputs.imageUrl || data.imageUrl,
          endFrameUrl: resolvedInputs.endFrameUrl,
          audioUrl: resolvedInputs.audioUrl,
          prompt: resolvedInputs.prompt || data.prompt || data.motionPrompt,
          provider,
          duration: data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          generateAudio: data.generateAudio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          grokMode: data.grokMode,
          videoSize: data.videoSize,
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
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          aspectRatio: data.aspectRatio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          resolution: data.resolution,
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          usageLogId,
        },
      }
    }

    case "video-to-video": {
      const v2vProvider = (data.provider as string) ?? "wan"
      return {
        jobName: "video-to-video",
        queueName: "video-generation" as const,
        modelIdentifier: v2vProvider,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          prompt: resolvedInputs.prompt || data.prompt,
          provider: v2vProvider,
          strength: data.strength,
          usageLogId,
        },
      }
    }

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
      // Frontend reads text from directText field when textSource is "direct"
      const ttsText = resolvedInputs.prompt
        || (data.textSource === "direct" ? data.directText : undefined)
        || data.text
      return {
        jobName: "text-to-speech",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          text: ttsText,
          voice: data.voiceId || data.voice,
          provider,
          voiceType: data.voiceType || "premade",
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
          genre: data.genre,
          mood: data.mood,
          instrumental: data.instrumental,
          lyrics: data.lyrics,
          referenceAudioUrl: resolvedInputs.audioUrl || data.referenceAudioUrl,
          usageLogId,
        },
      }
    }

    case "text-to-audio":
      return simpleResult("text-to-audio", "elevenlabs-sfx", {
        jobId,
        text: resolvedInputs.prompt || data.text || data.prompt,
        provider: data.provider,
        duration: data.duration,
        loop: data.loop,
        promptInfluence: data.promptInfluence,
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
        script: data.script ?? data.dialogue,
        stability: data.stability,
        languageCode: data.languageCode,
        usageLogId,
      })

    case "voice-changer":
      return simpleResult("voice-changer", "elevenlabs-voice-changer", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        voiceId: data.voiceId || data.voice,
        stability: data.stability,
        similarityBoost: data.similarityBoost,
        removeBackgroundNoise: data.removeBackgroundNoise,
        usageLogId,
      })

    case "dubbing":
      return simpleResult("dubbing", "elevenlabs-dubbing", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        targetLanguage: data.targetLanguage,
        sourceLanguage: data.sourceLanguage,
        numSpeakers: data.numSpeakers,
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
        voiceDescription: data.voiceDescription,
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
    case "suno-generate": {
      const hasCustomFields = !!(data.style || data.title || data.lyrics)
      return simpleResult("suno-generate", "suno-generate", {
        jobId,
        prompt: resolvedInputs.prompt || data.prompt,
        model: data.model,
        lyrics: data.lyrics,
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        styleWeight: data.styleWeight,
        weirdnessConstraint: data.weirdnessConstraint,
        audioWeight: data.audioWeight,
        customMode: data.customMode ?? hasCustomFields,
        instrumental: data.instrumental ?? false,
        isCustom: data.isCustom,
        tags: data.tags,
        usageLogId,
      })
    }

    case "suno-cover": {
      const hasCoverCustomFields = !!(data.style || data.title || data.lyrics)
      return simpleResult("suno-cover", "suno-cover", {
        jobId,
        prompt: resolvedInputs.prompt || data.prompt,
        uploadUrl: resolvedInputs.uploadUrl || resolvedInputs.audioUrl || data.uploadUrl || data.audioUrl,
        model: data.model,
        lyrics: data.lyrics,
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        customMode: data.customMode ?? hasCoverCustomFields,
        instrumental: data.instrumental ?? false,
        usageLogId,
      })
    }

    case "suno-extend":
      return simpleResult("suno-extend", "suno-extend", {
        jobId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId,
        defaultParamFlag: data.defaultParamFlag ?? true,
        prompt: resolvedInputs.prompt || data.prompt,
        model: data.model,
        style: data.style,
        title: data.title,
        continueAt: data.continueAt ?? data.continueFrom,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        styleWeight: data.styleWeight,
        weirdnessConstraint: data.weirdnessConstraint,
        audioWeight: data.audioWeight,
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
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        type: data.type || "separate_vocal",
        usageLogId,
      })

    case "suno-music-video":
      return simpleResult("suno-music-video", "suno-music-video", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
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
        tone: data.tone,
        targetDuration: data.targetDuration,
        provider: data.provider,
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
