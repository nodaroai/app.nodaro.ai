// @registry-enumerates HANDLER_PROVIDERS carries every node unit whose worker names its provider (providerOf)
// backend/src/lib/concurrency-lanes/provider-of.ts — the PRIMARY provider a
// job or an LLM call counts against, the key of the gate's platform-wide
// provider ceilings (setProviderCeilings). Unknown → null: never ceilinged.
//
// A job:
//   1. a local-lane job (ffmpeg, sharp, Remotion) → "local";
//   1b. a job whose payload `provider` is a house model (an own-label catalog
//      id, lib/house-models.ts) → "house-models", whatever the job;
//   2. a handler that calls one provider client whatever its payload →
//      HANDLER_PROVIDERS (the core handlers ∪ the node units whose worker
//      names its provider, `provider:*`, through unit-descriptors.ts providerOf);
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
  retiredLipSyncProviderName,
  canonicalVideoProvider,
} from "@nodaro/shared/models"
import { baseProviderChain } from "../../providers/base-chain.js"
import type { ProviderCapability } from "../../providers/provider.interface.js"
import { providerRegistry } from "../../providers/registry.js"
import { resolveModel } from "../llm/params.js"
import { laneForCallNow } from "../llm/router.js"
import type { LlmRequest } from "../llm/types.js"
import { isTailRecipeProvider, TAIL_RECIPES } from "../extend-recipe.js"
import {
  CHARACTER_MOTION_DEFAULT_PROVIDER, CREATURE_MOTION_DEFAULT_PROVIDER, EDIT_IMAGE_DEFAULT_PROVIDER, generateImageModelOf,
  IMAGE_TO_VIDEO_DEFAULT_PROVIDER, LIP_SYNC_DEFAULT_PROVIDER, LOCATION_MOTION_DEFAULT_PROVIDER, MOTION_TRANSFER_DEFAULT_PROVIDER,
  OBJECT_MOTION_DEFAULT_PROVIDER, TEXT_TO_VIDEO_DEFAULT_PROVIDER, VIDEO_TO_VIDEO_DEFAULT_PROVIDER, VIDEO_UPSCALE_DEFAULT_PROVIDER,
  VOICED_VIDEO_DEFAULT_PROVIDER, type GenerateImageModelInput,
} from "../../workers/handlers/default-models.js"
import { composeRecord, unitRecord } from "../unit-compose.js"
import { providerOf, UNIT_NODE_DESCRIPTORS } from "../unit-descriptors.js"
import { laneClassOf } from "./registry.js"
import { HOUSE_MODELS_PROVIDER, isOwnLabelModel } from "../house-models-served.js"

/**
 * Core handlers that call one provider client whatever the payload (each
 * checked against its handler under workers/handlers/).
 */
const CORE_HANDLER_PROVIDERS: Readonly<Record<string, string>> = Object.freeze({
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
  // The background scrapes (handlers/background-scrape.ts): an Apify actor,
  // relayed to the connected cloud on a keyless install (counted as Apify).
  "site-capture": "apify",
  "meta-ads-scrape": "apify",
  "instagram-scrape": "apify",
})

/**
 * Handlers that call one provider client whatever the payload: the core ones ∪
 * every node unit whose worker names its provider (its `provider:*`
 * capability, read through providerOf — a unit's job name is its type), so no
 * row here names a unit. Unchanged (the core table itself) with no such unit.
 */
export const HANDLER_PROVIDERS: Readonly<Record<string, string>> = Object.freeze(
  composeRecord("HANDLER_PROVIDERS", CORE_HANDLER_PROVIDERS, unitRecord(UNIT_NODE_DESCRIPTORS, (u) => providerOf(u.type))),
)

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

/**
 * The provider the provider router serves `model` from for `capability`, as
 * it walks the chain (routedProvider); null when none in this process lists
 * it. For a caller that hands the router a model directly (the plugin
 * toolkit's members).
 */
export function providerServingModel(capability: ProviderCapability, model: string): string | null {
  return routedProvider(capability, model)
}

const route = (capability: ProviderCapability, model: string | undefined): string | null =>
  model ? routedProvider(capability, model) : null

/** generate-image / reference-board: the model the handler resolves, swapped to its image-to-image sibling for an edit of a base. */
function generateImageProvider(d: Data): string | null {
  const { effectiveModel } = generateImageModelOf(d as GenerateImageModelInput)
  return route("image-generation", typeof effectiveModel === "string" ? effectiveModel : undefined)
}

function lipSyncProvider(d: Data): string | null {
  const model = str(d.provider) ?? LIP_SYNC_DEFAULT_PROVIDER
  // A retired model ran on Replicate (a job queued before it was retired).
  if (REPLICATE_LIP_SYNC_PROVIDERS.has(model as never) || retiredLipSyncProviderName(model) !== undefined) return "replicate"
  if (FAL_LIP_SYNC_PROVIDERS.has(model as never)) return "fal"
  if (SEEDANCE_LIP_SYNC_PROVIDERS.has(model as never)) return route("image-to-video", model)
  return route("lip-sync", model)
}

function videoUpscaleProvider(d: Data): string | null {
  const model = str(d.provider) ?? VIDEO_UPSCALE_DEFAULT_PROVIDER
  // Task re-renders of a prior KIE generation, outside the router.
  if (model === SEEDANCE_DRAFT_FINALIZE_PROVIDER) return "kie"
  if ((model === "veo-1080p" || model === "veo-4k") && str(d.kieTaskId)) return "kie"
  return route("video-upscale", VIDEO_UPSCALE_DEFAULT_PROVIDER)
}

/** An entity motion: image-to-video from its still, or video-to-video when it refines a clip. */
const entityMotion = (defaultModel: string, canRefine: boolean) => (d: Data): string | null =>
  route(canRefine && str(d.refineFromVideoUrl) ? "video-to-video" : "image-to-video", str(d.provider) ?? defaultModel)

const entityImage = (d: Data): string | null =>
  route("image-generation", str(d.provider) ?? IMAGE_MODEL_ROLE_DEFAULTS.character)

function extendVideoProvider(d: Data): string | null {
  const model = canonicalVideoProvider(str(d.provider))
  if (model === "ltx-2.3-pro") return "replicate" // runLtxExtend
  // A tail recipe generates its continuation on its own model (extend-recipe.ts).
  if (typeof model === "string" && isTailRecipeProvider(model)) return route("image-to-video", TAIL_RECIPES[model].genModel)
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
  "edit-image": (d) => route("image-editing", str(d.provider) ?? EDIT_IMAGE_DEFAULT_PROVIDER),
  "image-to-video": (d) => route("image-to-video", str(d.provider) ?? IMAGE_TO_VIDEO_DEFAULT_PROVIDER),
  "text-to-video": (d) => route("text-to-video", str(d.provider) ?? TEXT_TO_VIDEO_DEFAULT_PROVIDER),
  "video-to-video": (d) => route("video-to-video", str(d.provider) ?? VIDEO_TO_VIDEO_DEFAULT_PROVIDER),
  "motion-transfer": (d) => route("motion-transfer", str(d.provider) ?? MOTION_TRANSFER_DEFAULT_PROVIDER),
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
  "generate-character-motion": entityMotion(CHARACTER_MOTION_DEFAULT_PROVIDER, false),
  "generate-location-motion": entityMotion(LOCATION_MOTION_DEFAULT_PROVIDER, true),
  "generate-object-motion": entityMotion(OBJECT_MOTION_DEFAULT_PROVIDER, true),
  "generate-creature-motion": entityMotion(CREATURE_MOTION_DEFAULT_PROVIDER, true),
  // The clip is image-to-video; its dialogue track (ElevenLabs) is a side call.
  "voiced-video": (d) => route("image-to-video", str(d.provider) ?? VOICED_VIDEO_DEFAULT_PROVIDER),
  "extend-video": extendVideoProvider,
  "video-depth": videoDepthProvider,
  // tangoflux (Replicate) is reachable only from a stale payload; elevenlabs-sfx is the default.
  "text-to-audio": (d) => (str(d.provider) === "tangoflux" ? "replicate" : "elevenlabs"),
  "transcribe": (d) => {
    const engine = str(d.provider) ?? DEFAULT_TRANSCRIBE_PROVIDER
    return engine === "elevenlabs-stt" ? "elevenlabs" : engine === "nemotron-3-5-transcribe" ? "kie" : "replicate"
  },
  // An RSS feed is a plain fetch on this server; every other actor is Apify's.
  "web-scrape": (d) => {
    const body = d.body !== null && typeof d.body === "object" ? (d.body as Data) : {}
    return body.actor === "rss" ? null : "apify"
  },
})

const LOCAL_QUEUES = ["video-generation", "video-render"] as const

/** The provider a job named `jobName` counts against, or null when it is not one provider's. */
export function primaryProviderOfJob(jobName: string, data: unknown): string | null {
  const isLocal = LOCAL_QUEUES.some((q) => {
    const cls = laneClassOf(q, jobName, data)
    return cls.kind === "leaf" && cls.lane === "local"
  })
  if (isLocal) return "local"
  const d = data !== null && typeof data === "object" ? (data as Data) : {}
  // A house model (an own-label catalog id, lib/house-models.ts) runs through
  // the deployment's own service whatever the job: one neutral name, never an upstream's.
  if (isOwnLabelModel(d.provider)) return HOUSE_MODELS_PROVIDER
  if (Object.hasOwn(HANDLER_PROVIDERS, jobName)) return HANDLER_PROVIDERS[jobName]!
  const routed = Object.hasOwn(ROUTED_JOBS, jobName) ? ROUTED_JOBS[jobName]! : undefined
  if (!routed) return null
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
