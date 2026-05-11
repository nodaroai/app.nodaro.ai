/**
 * Replicate Provider Registration
 *
 * Registers all Replicate provider modules (image, video)
 * with the central ProviderRegistry.
 *
 * Note: Replicate does NOT support the following capabilities
 * (those are KIE-only or handled by other providers):
 * - video-to-video
 * - motion-transfer
 * - video-upscale
 * - lip-sync
 * - music-generation (handled separately via Replicate models but not KIE-comparable)
 * - text-to-speech (handled separately via Replicate ElevenLabs model)
 * - transcription
 */

import { providerRegistry } from "../registry.js"
import type { ProviderInfo } from "../provider.interface.js"
import { ReplicateImageProvider } from "./image.js"
import { ReplicateVideoProvider } from "./video.js"

const replicateInfo: ProviderInfo = {
  id: "replicate",
  name: "Replicate",
  capabilities: [
    "image-generation",
    "image-to-video",
    "text-to-video",
  ],
  supportedModels: {
    "image-generation": [
      "nano-banana",
      "flux",
      "dalle",
      "midjourney",
    ],
    "image-editing": [],
    "image-to-video": [
      "minimax",
      "veo3",
      "veo3.1",
      "kling",
      "kling-3-omni",
      "runway",
      "pika",
    ],
    "text-to-video": [
      "minimax",
      "veo3",
      "kling",
      "runway",
      "pika",
    ],
    "video-to-video": [],
    "motion-transfer": [],
    "video-upscale": [],
    "lip-sync": [],
    "music-generation": [],
    "text-to-speech": [],
    "sound-effect": [],
    "audio-isolation": [],
    "transcription": [],
    "dialogue": [],
  },
}

export function registerReplicateProviders(): void {
  providerRegistry.register(replicateInfo, {
    image: new ReplicateImageProvider(),
    video: new ReplicateVideoProvider(),
  })
}
