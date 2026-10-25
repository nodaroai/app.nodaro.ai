/**
 * KIE.ai Provider Registration
 *
 * Registers all KIE provider modules (image, video, audio)
 * with the central ProviderRegistry.
 */

import { providerRegistry } from "../registry.js"
import type { ProviderInfo } from "../provider.interface.js"
import { KieImageProvider } from "./image.js"
import { KieVideoProvider } from "./video.js"
import { KieAudioProvider } from "./audio.js"
import {
  KIE_IMAGE_MODELS,
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
  KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS,
  KIE_MUSIC_MODELS,
  KIE_TTS_MODELS,
  KIE_AUDIO_ISOLATION_MODELS,
  KIE_STT_MODELS,
} from "./models.js"

/**
 * Model keys KIE no longer serves for us. Their configs stay in models.ts so
 * the admin credit audit can still read past KIE bills; routing never offers
 * them, so the router falls through to the provider that does (the Topaz
 * upscalers moved to Replicate 2026-10-25).
 */
export const KIE_RETIRED_MODEL_KEYS: ReadonlySet<string> = new Set(["topaz", "topaz-image-upscale"])

const kieInfo: ProviderInfo = {
  id: "kie",
  name: "KIE.ai",
  capabilities: [
    "image-generation",
    "image-editing",
    "image-to-video",
    "text-to-video",
    "video-to-video",
    "motion-transfer",
    "lip-sync",
    "speech-to-video",
    "music-generation",
    "text-to-speech",
    "audio-isolation",
    "transcription",
  ],
  supportedModels: {
    "image-generation": Object.keys(KIE_IMAGE_MODELS),
    "image-editing": Object.keys(KIE_IMAGE_MODELS).filter(
      (k) => KIE_IMAGE_MODELS[k].inputType === "image-to-image" && !KIE_RETIRED_MODEL_KEYS.has(k)
    ),
    "image-to-video": Object.keys(KIE_VIDEO_MODELS),
    "text-to-video": Object.keys(KIE_TEXT_TO_VIDEO_MODELS),
    "video-to-video": Object.keys(KIE_VIDEO_TO_VIDEO_MODELS),
    "motion-transfer": Object.keys(KIE_MOTION_TRANSFER_MODELS),
    // Topaz video upscale runs on Replicate since 2026-10-25 (KIE's lane had
    // stopped working); the config stays in models.ts for the credit audit only.
    "video-upscale": Object.keys(KIE_VIDEO_UPSCALE_MODELS).filter((k) => !KIE_RETIRED_MODEL_KEYS.has(k)),
    "lip-sync": Object.keys(KIE_LIP_SYNC_MODELS),
    // Single-model node: the routing id matches the credit identifier; the
    // provider resolves the actual KIE model (wan-s2v) internally.
    "speech-to-video": ["speech-to-video"],
    "music-generation": Object.keys(KIE_MUSIC_MODELS),
    "text-to-speech": Object.keys(KIE_TTS_MODELS),
    // Sound effects left KIE for the direct ElevenLabs API (2026-10-05: KIE's
    // sound-effect wrapper failed every request); the capability key stays —
    // the Record is exhaustive over ProviderCapability.
    "sound-effect": [],
    "audio-isolation": Object.keys(KIE_AUDIO_ISOLATION_MODELS),
    "audio-separation": [], // KIE has no Demucs; Replicate-only capability
    "transcription": Object.keys(KIE_STT_MODELS),
    // Dialogue left KIE for the direct ElevenLabs API (the last proxy to go);
    // the capability key stays — the Record is exhaustive over ProviderCapability.
    "dialogue": [],
  },
}

export function registerKieProviders(): void {
  providerRegistry.register(kieInfo, {
    image: new KieImageProvider(),
    video: new KieVideoProvider(),
    audio: new KieAudioProvider(),
  })
}
