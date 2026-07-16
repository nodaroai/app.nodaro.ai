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
import { ReplicateAudioSeparationProvider } from "./audio-separation.js"

const LTX_VIDEO_MODEL_IDS = ["ltx-2.3-pro", "ltx-2.3-fast"] as const

// Replicate-only video ids beyond LTX. kling-3-omni (kwaivgi/kling-v3-omni-video,
// added in #2307) was silently dropped from this registration when #2439 rewrote
// replicateInfo — the router then found NO provider for it and every run failed
// with "not supported by any registered provider" (caught by live probe
// 2026-07-16; guarded since by video-provider-dispatch.test.ts). i2v-only:
// the t2v route 400s first via VIDEO_PROVIDERS_REQUIRING_IMAGE.
const REPLICATE_I2V_ONLY_MODEL_IDS = ["kling-3-omni"] as const

const replicateInfo: ProviderInfo = {
  id: "replicate",
  name: "Replicate",
  capabilities: ["image-generation", "audio-separation"],
  supportedModels: {
    "image-generation": REPLICATE_IMAGE_MODEL_IDS,
    "image-editing": [],
    "image-to-video": [...LTX_VIDEO_MODEL_IDS, ...REPLICATE_I2V_ONLY_MODEL_IDS],
    "text-to-video": [...LTX_VIDEO_MODEL_IDS],
    "video-to-video": [],
    "motion-transfer": [],
    "video-upscale": [],
    "lip-sync": [],
    "music-generation": [],
    "text-to-speech": [],
    "sound-effect": ["replicate-mmaudio"],
    "audio-isolation": [],
    "audio-separation": ["demucs"],
    "transcription": [],
    "dialogue": [],
  },
}

export function registerReplicateProviders(): void {
  providerRegistry.register(replicateInfo, {
    image: new ReplicateImageProvider(),
    video: new ReplicateVideoProvider(),
    audioSeparation: new ReplicateAudioSeparationProvider(),
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
