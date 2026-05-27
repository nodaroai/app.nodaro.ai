/**
 * Replicate Provider Registration
 *
 * Currently scoped to a small set of "Open" (uncensored) image models that
 * are only available on Replicate. The router's chain falls through to
 * Replicate when KIE doesn't declare a model id.
 */

import { providerRegistry } from "../registry.js"
import type { ProviderInfo } from "../provider.interface.js"
import { ReplicateImageProvider, REPLICATE_IMAGE_MODEL_IDS } from "./image.js"
import { ReplicateVideoProvider } from "./video.js"

const replicateInfo: ProviderInfo = {
  id: "replicate",
  name: "Replicate",
  capabilities: ["image-generation"],
  supportedModels: {
    "image-generation": REPLICATE_IMAGE_MODEL_IDS,
    "image-editing": [],
    "image-to-video": [],
    "text-to-video": [],
    "video-to-video": [],
    "motion-transfer": [],
    "video-upscale": [],
    "lip-sync": [],
    "music-generation": [],
    "text-to-speech": [],
    "sound-effect": ["replicate-mmaudio"],
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
