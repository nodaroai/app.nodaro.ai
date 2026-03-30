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
  KIE_SOUND_EFFECT_MODELS,
  KIE_AUDIO_ISOLATION_MODELS,
  KIE_STT_MODELS,
  KIE_DIALOGUE_MODELS,
} from "./models.js"

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
    "video-upscale",
    "lip-sync",
    "music-generation",
    "text-to-speech",
    "audio-isolation",
    "transcription",
    "dialogue",
  ],
  supportedModels: {
    "image-generation": Object.keys(KIE_IMAGE_MODELS),
    "image-editing": Object.keys(KIE_IMAGE_MODELS).filter(
      (k) => KIE_IMAGE_MODELS[k].inputType === "image-to-image"
    ),
    "image-to-video": Object.keys(KIE_VIDEO_MODELS),
    "text-to-video": Object.keys(KIE_TEXT_TO_VIDEO_MODELS),
    "video-to-video": Object.keys(KIE_VIDEO_TO_VIDEO_MODELS),
    "motion-transfer": Object.keys(KIE_MOTION_TRANSFER_MODELS),
    "video-upscale": Object.keys(KIE_VIDEO_UPSCALE_MODELS),
    "lip-sync": Object.keys(KIE_LIP_SYNC_MODELS),
    "music-generation": Object.keys(KIE_MUSIC_MODELS),
    "text-to-speech": Object.keys(KIE_TTS_MODELS),
    "sound-effect": Object.keys(KIE_SOUND_EFFECT_MODELS),
    "audio-isolation": Object.keys(KIE_AUDIO_ISOLATION_MODELS),
    "transcription": Object.keys(KIE_STT_MODELS),
    "dialogue": Object.keys(KIE_DIALOGUE_MODELS),
  },
}

export function registerKieProviders(): void {
  providerRegistry.register(kieInfo, {
    image: new KieImageProvider(),
    video: new KieVideoProvider(),
    audio: new KieAudioProvider(),
  })
}
