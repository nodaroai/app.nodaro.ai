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

const LTX_VIDEO_MODEL_IDS = ["ltx-2.3-pro", "ltx-2.3-fast"] as const

const replicateInfo: ProviderInfo = {
  id: "replicate",
  name: "Replicate",
  capabilities: ["image-generation"],
  supportedModels: {
    "image-generation": REPLICATE_IMAGE_MODEL_IDS,
    "image-editing": [],
    "image-to-video": [...LTX_VIDEO_MODEL_IDS],
    "text-to-video": [...LTX_VIDEO_MODEL_IDS],
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

// Re-export LTX 2.3 task functions so other backend code can import them
// from "./providers/replicate/index.js"
export {
  runLtxTextToVideo,
  runLtxImageToVideo,
  runLtxAudioToVideo,
  runLtxExtend,
  runLtxRetake,
} from "./ltx-video.js"
export type {
  LtxTextToVideoArgs,
  LtxImageToVideoArgs,
  LtxAudioToVideoArgs,
  LtxExtendArgs,
  LtxRetakeArgs,
} from "./ltx-video.js"
