// backend/src/lib/concurrency-lanes/provider-of.ts — the PRIMARY provider a
// job or an LLM call counts against, the key of the gate's platform-wide
// provider ceilings (setProviderCeilings). Unknown → null: never ceilinged.
//
// A job:
//   1. a local-lane job (ffmpeg, sharp, Remotion) → "local";
//   2. a handler that calls one provider client whatever its payload →
//      HANDLER_PROVIDERS;
//   3. a handler whose provider follows from its payload → ROUTED_JOBS, each
//      entry deciding as its handler decides. A handler that goes through the
//      provider router counts against the first provider in the capability's
//      chain (providers/base-chain.ts, the chain buildRoutingDecision builds)
//      whose registered `supportedModels` for that capability lists the job's
//      model — the router's own walk, so a retired KIE key
//      (topaz-image-upscale) never attributes to KIE. The model is resolved as
//      the handler resolves it, default included;
//   4. a provider-lane job that calls no AI provider at pickup → UNATTRIBUTED,
//      each with its reason; anything else (a coordinator, an llm-lane job —
//      its LLM calls are attributed one by one) → null.
// Every provider-lane job of the registry is in exactly one of the three
// tables (__tests__/provider-of.test.ts fails a new one that is not).
//
// What it does not see:
//   - plugins: the tables cover core handlers only. A plugin that replaces a
//     core job type's handler (on Cloud) is still attributed as the core
//     handler would be, and a plugin's own provider-lane type is null until a
//     plugin can declare its provider;
//   - the Nodaro Cloud leg of the chain (a community install's connection)
//     needs the async app settings and is left out: there a job its own keys
//     cannot serve counts against null, not "nodaro". The ElevenLabs, HeyGen
//     and Beeble handlers relay to that connection on a keyless install; they
//     count against their vendor either way;
//   - providers this process never registered: a router job is attributed
//     through the LIVE provider registry, so the calling process must have run
//     initProviders (the video worker does at boot), and a provider whose key
//     it lacks is not in the walk.
//
// An LLM call counts against the provider the LLM router serves it from now
// (laneForCallNow in lib/llm/router.ts: keys and refused-account latches).
import { FAL_VIDEO_DEPTH_PROVIDERS, REPLICATE_VIDEO_DEPTH_PROVIDERS } from "@nodaro/shared/media"
import { defaultImageModel, IMAGE_MODEL_ROLE_DEFAULTS, SEEDANCE_DRAFT_FINALIZE_PROVIDER } from "@nodaro/shared/model-catalog"
import {
  FAL_LIP_SYNC_PROVIDERS,
  REPLICATE_LIP_SYNC_PROVIDERS,
  SEEDANCE_LIP_SYNC_PROVIDERS,
  DEFAULT_TRANSCRIBE_PROVIDER,
  T2I_TO_I2I_VARIANT,
} from "@nodaro/shared/models"
import { baseProviderChain } from "../../providers/base-chain.js"
import type { ProviderCapability } from "../../providers/provider.interface.js"
import { providerRegistry } from "../../providers/registry.js"
import { resolveModel } from "../llm/params.js"
import { laneForCallNow } from "../llm/router.js"
import type { LlmRequest } from "../llm/types.js"
import { seedanceExtendGenerationModel } from "../seedance-extend-model.js"
import { laneClassOf } from "./registry.js"

/**
 * Handlers that call one provider client whatever the payload (each checked
 * against its handler under workers/handlers/).
 */
export const HANDLER_PROVIDERS: Readonly<Record<string, string>> = Object.freeze({
  "text-to-speech": "elevenlabs", // directElevenLabsTTS
  "voice-changer": "elevenlabs", // directVoiceChanger / voiceChangerFromUrl
  "voice-design": "elevenlabs", // designVoice
  "voice-remix": "elevenlabs", // remixVoice
  "dubbing": "elevenlabs", // startDubbing
  "text-to-dialogue": "elevenlabs", // directElevenLabsDialogue
  "forced-alignment": "elevenlabs", // forcedAlignment / forcedAlignmentFromBuffer
  "audio-isolation": "kie", // KieAudioProvider.isolateAudio (KIE's elevenlabs-isolation task)
  "audio-separation": "replicate", // ReplicateAudioSeparationProvider (Demucs)
  "generate-music": "replicate", // providers/audio/generate-music.ts: every engine is a replicate.run
  "video-retake": "replicate", // runLtxRetake (LTX on Replicate)
  "face-swap": "replicate", // replicateFaceSwap
  "generate-mask": "replicate", // runGroundedSam
  "video-sfx": "replicate", // generateVideoSfx (MMAudio)
  "video-mask": "fal", // runSam3Video — every VIDEO_MASK_PROVIDERS model is a fal model
  "ai-avatar": "heygen", // generateAvatarVideo
  "cinematic-avatar": "heygen", // generateCinematicAvatar
  "switchx": "beeble", // startSwitchXGeneration (providers/beeble)
  // Suno runs on KIE (the cloud relay is taken only when KIE_API_KEY is unset);
  // suno-separate's Demucs fallback on Replicate runs only after KIE refused.
  "suno-generate": "kie",
  "suno-cover": "kie",
  "suno-extend": "kie",
  "suno-lyrics": "kie",
  "suno-separate": "kie",
  "suno-music-video": "kie",
  "suno-mashup": "kie",
  "suno-replace-section": "kie",
  "suno-add-instrumental": "kie",
  "suno-add-vocals": "kie",
  "suno-convert-wav": "kie",
  "suno-upload-extend": "kie",
})

/** Provider-lane jobs that call no AI provider when they start, each with why — never ceilinged. */
export const UNATTRIBUTED: Readonly<Record<string, string>> = Object.freeze({
  "extract-youtube-audio": "downloads with yt-dlp through the proxy pool; no AI provider is called",
})

type Data = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** The first provider in the capability's chain that serves `model`, as the router walks it. */
function routedProvider(capability: ProviderCapability, model: string): string | null {
  return baseProviderChain(capability).find((id) => providerRegistry.supportsModel(id, capability, model)) ?? null
}

const route = (capability: ProviderCapability, model: string | undefined): string | null =>
  model ? routedProvider(capability, model) : null

/** generate-image / reference-board: the handler's model, swapped to its image-to-image sibling for an edit of a base. */
function generateImageProvider(d: Data): string | null {
  const model = str(d.model) ?? str(d.provider) ?? defaultImageModel("general", str(d.aspectRatio))
  const refs = Array.isArray(d.referenceImageUrls) ? d.referenceImageUrls : []
  const base = str(d.baseImageUrl) ?? str(refs[0])
  const isI2I = Boolean(str(d.maskUrl) && base) || Boolean(str(d.baseImageUrl))
  return route("image-generation", isI2I ? (T2I_TO_I2I_VARIANT[model] ?? model) : model)
}

function lipSyncProvider(d: Data): string | null {
  const model = str(d.provider) ?? "kling-avatar"
  if (REPLICATE_LIP_SYNC_PROVIDERS.has(model as never)) return "replicate"
  if (FAL_LIP_SYNC_PROVIDERS.has(model as never)) return "fal"
  if (SEEDANCE_LIP_SYNC_PROVIDERS.has(model as never)) return route("image-to-video", model)
  return route("lip-sync", model)
}

function videoUpscaleProvider(d: Data): string | null {
  const model = str(d.provider) ?? "topaz"
  // Task re-renders of a prior KIE generation, outside the router.
  if (model === SEEDANCE_DRAFT_FINALIZE_PROVIDER) return "kie"
  if ((model === "veo-1080p" || model === "veo-4k") && str(d.kieTaskId)) return "kie"
  return route("video-upscale", "topaz")
}

/** An entity motion: image-to-video from its still, or video-to-video when it refines a clip. */
const entityMotion = (defaultModel: string, canRefine: boolean) => (d: Data): string | null =>
  route(canRefine && str(d.refineFromVideoUrl) ? "video-to-video" : "image-to-video", str(d.provider) ?? defaultModel)

const entityImage = (d: Data): string | null =>
  route("image-generation", str(d.provider) ?? IMAGE_MODEL_ROLE_DEFAULTS.character)

function extendVideoProvider(d: Data): string | null {
  const model = str(d.provider)
  if (model === "ltx-2.3-pro") return "replicate" // runLtxExtend
  if (model === "seedance-2-extend") return route("image-to-video", seedanceExtendGenerationModel())
  return "kie" // veo-extend / runway-extend: KIE task extensions of a prior KIE generation
}

function videoDepthProvider(d: Data): string | null {
  const model = str(d.provider) ?? "video-depth-anything"
  if (FAL_VIDEO_DEPTH_PROVIDERS.has(model as never)) return "fal"
  if (REPLICATE_VIDEO_DEPTH_PROVIDERS.has(model as never)) return "replicate"
  return null // the handler refuses an unknown model before any call
}

/** Jobs whose provider follows from the payload, each decided as its handler decides. */
export const ROUTED_JOBS: Readonly<Record<string, (d: Data) => string | null>> = Object.freeze({
  "generate-image": generateImageProvider,
  "reference-board": generateImageProvider,
  "image-to-image": (d) => route("image-generation", str(d.provider) ?? defaultImageModel("edit", str(d.aspectRatio))),
  "edit-image": (d) => route("image-editing", str(d.provider) ?? "recraft-upscale"),
  "image-to-video": (d) => route("image-to-video", str(d.provider) ?? "minimax"),
  "text-to-video": (d) => route("text-to-video", str(d.provider) ?? "minimax"),
  "video-to-video": (d) => route("video-to-video", str(d.provider) ?? "wan"),
  "motion-transfer": (d) => route("motion-transfer", str(d.provider) ?? "kling"),
  "speech-to-video": () => route("speech-to-video", "speech-to-video"),
  "lip-sync": lipSyncProvider,
  "video-upscale": videoUpscaleProvider,
  "generate-character": entityImage,
  "generate-face": entityImage,
  "generate-character-asset": entityImage,
  "generate-object": entityImage,
  "generate-object-asset": entityImage,
  "generate-creature": entityImage,
  "generate-creature-asset": entityImage,
  "generate-location": entityImage,
  "generate-location-asset": entityImage,
  "generate-character-motion": entityMotion("kling", false),
  "generate-location-motion": entityMotion("kling", true),
  "generate-object-motion": entityMotion("kling-turbo", true),
  "generate-creature-motion": entityMotion("kling-turbo", true),
  // The clip is image-to-video; its dialogue track (ElevenLabs) is a side call.
  "voiced-video": (d) => route("image-to-video", str(d.provider) ?? "minimax"),
  "extend-video": extendVideoProvider,
  "video-depth": videoDepthProvider,
  // tangoflux (Replicate) is reachable only from a stale payload; elevenlabs-sfx is the default.
  "text-to-audio": (d) => (str(d.provider) === "tangoflux" ? "replicate" : "elevenlabs"),
  "transcribe": (d) => ((str(d.provider) ?? DEFAULT_TRANSCRIBE_PROVIDER) === "elevenlabs-stt" ? "elevenlabs" : "replicate"),
})

const LOCAL_QUEUES = ["video-generation", "video-render"] as const

/** The provider a job named `jobName` counts against, or null when it is not one provider's. */
export function primaryProviderOfJob(jobName: string, data: unknown): string | null {
  const isLocal = LOCAL_QUEUES.some((q) => {
    const cls = laneClassOf(q, jobName, data)
    return cls.kind === "leaf" && cls.lane === "local"
  })
  if (isLocal) return "local"
  if (Object.hasOwn(HANDLER_PROVIDERS, jobName)) return HANDLER_PROVIDERS[jobName]!
  const routed = Object.hasOwn(ROUTED_JOBS, jobName) ? ROUTED_JOBS[jobName]! : undefined
  if (!routed) return null
  const d = data !== null && typeof data === "object" ? (data as Data) : {}
  return routed(d)
}

/**
 * The provider one LLM call counts against: the one the LLM router serves it
 * from if it is made now — "kie", "anthropic" or "google" (laneForCallNow,
 * which reads the keys and the refused-account latches as the router does;
 * there is no OpenAI direct lane, so "openai" is never returned). The model
 * is resolved as the router resolves it (a feature's default when the request
 * names none). Null when the router would refuse the call outright (an
 * unknown model, no key that can serve it).
 */
export function primaryProviderOfLlm(req: LlmRequest): string | null {
  let model
  try {
    model = resolveModel(req)
  } catch {
    return null
  }
  return laneForCallNow(model, req)
}
