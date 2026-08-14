/**
 * Nodaro Cloud Provider Registration (community cloud-connect, Phase 4a).
 *
 * "Nodaro is a provider in the community edition's provider list" — the
 * instance generates through the connected cloud's public /v1 routes with its
 * stored `ndr_app_` token, billing the connected cloud account's wallet.
 *
 * Registered ONLY when the instance holds a usable cloud token at boot
 * (isNodaroConnected). Routing keeps user-key providers first: config.ts
 * appends "nodaro" at the END of the capability chains, so local KIE /
 * Replicate keys win for every model they declare and the cloud connection is
 * an addition, never a hijack.
 *
 * `supportedModels` mirrors the KIE provider's model lists for the three
 * connected capabilities — the same ids the cloud's own routes accept (the
 * cloud serves them via its KIE integration). Derived from kie/models.ts so a
 * new KIE model is claimable through the connection with zero edits here.
 */

import { providerRegistry } from "../registry.js"
import type { ProviderInfo } from "../provider.interface.js"
import { isNodaroConnected } from "../../lib/nodaro-connect.js"
import { NodaroCloudImageProvider } from "./image.js"
import { NodaroCloudVideoProvider } from "./video.js"
import { NodaroCloudAudioProvider } from "./audio.js"
import {
  KIE_IMAGE_MODELS,
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
} from "../kie/models.js"
import {
  IMAGE_EDIT_PROVIDERS,
  LIP_SYNC_PROVIDERS,
  MOTION_TRANSFER_PROVIDERS,
  VIDEO_TO_VIDEO_PROVIDERS,
  TTS_PROVIDERS,
  VIDEO_UPSCALE_PROVIDERS,
} from "@nodaro/shared"

export const NODARO_PROVIDER_ID = "nodaro"

const nodaroInfo: ProviderInfo = {
  id: NODARO_PROVIDER_ID,
  name: "nodaro.ai",
  capabilities: [
    "image-generation",
    "image-editing",
    "image-to-video",
    "text-to-video",
    "video-to-video",
    "motion-transfer",
    "video-upscale",
    "lip-sync",
    "speech-to-video",
    "text-to-speech",
  ],
  supportedModels: {
    "image-generation": Object.keys(KIE_IMAGE_MODELS),
    // Declared from the CLOUD ROUTE's own enums rather than a KIE catalog:
    // the cloud holds every provider key, so what it accepts is exactly what
    // the connection can serve. A provider added to the enum is claimed here
    // automatically instead of needing a second list kept in step.
    "image-editing": [...IMAGE_EDIT_PROVIDERS],
    "image-to-video": Object.keys(KIE_VIDEO_MODELS),
    "text-to-video": Object.keys(KIE_TEXT_TO_VIDEO_MODELS),
    "video-to-video": [...VIDEO_TO_VIDEO_PROVIDERS],
    "motion-transfer": [...MOTION_TRANSFER_PROVIDERS],
    "video-upscale": [...VIDEO_UPSCALE_PROVIDERS],
    "lip-sync": [...LIP_SYNC_PROVIDERS],
    // Single-model node (Wan S2V) — the cloud's /v1/speech-to-video route
    // takes no provider field, so the routing id is the node's own name.
    "speech-to-video": ["speech-to-video"],
    "music-generation": [],
    // Speech is the node a keyless install hits first. The cloud serves every
    // TTS model the route accepts (it holds the ElevenLabs key), so claim the
    // route's own enum — see the image-editing note above for why not a
    // hand-kept list.
    "text-to-speech": [...TTS_PROVIDERS],
    "sound-effect": [],
    "audio-isolation": [],
    "audio-separation": [],
    "transcription": [],
    "dialogue": [],
  },
}

/** Unconditional registration — callers gate on connection state. */
export function registerNodaroCloudProvider(): void {
  providerRegistry.register(nodaroInfo, {
    image: new NodaroCloudImageProvider(),
    video: new NodaroCloudVideoProvider(),
    audio: new NodaroCloudAudioProvider(),
  })
}

/**
 * Boot-time registration gate: registers the provider ONLY when the instance
 * holds a usable cloud token. Returns whether registration happened.
 *
 * Connecting from the Integrations page stores the token in the API process;
 * the worker process (where providers execute) picks it up at its next boot —
 * "registered at boot" by design, per the Phase 4a plan.
 */
export async function registerNodaroCloudProviderIfConnected(): Promise<boolean> {
  if (!(await isNodaroConnected())) return false
  registerNodaroCloudProvider()
  return true
}
