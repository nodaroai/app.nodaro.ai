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
import {
  isNodaroConnected,
  readNodaroConnectionState,
  type NodaroConnectionState,
} from "../../lib/nodaro-connect.js"
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

/**
 * Boot-time registration that survives the community stack's boot order.
 *
 * The worker reads the connection through the container's OWN Caddy
 * (SUPABASE_URL = localhost:3000/supabase), and start.sh brings Caddy up only
 * after the API answers /health — so the first read at worker init fails
 * deterministically ("fetch failed"; 2026-08-16 timeline: read at +7s, Caddy
 * serving at +8.3s). A single fire-and-forget attempt left the provider
 * unregistered on EVERY community boot, and only the router's one-shot
 * self-heal on the first job hid it.
 *
 * Retries while the store is `unavailable`, stops on a definitive
 * `not-connected`, registers on `connected`. `onAttempt` fires after every
 * attempt — providersReady() hangs off the FIRST one so boot never waits for
 * the whole window. Idempotent: a no-op once the provider is registered (the
 * self-heal may have won the race).
 */
export const NODARO_REGISTRATION_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000]

export interface RegisterWithRetryOptions {
  delaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  onAttempt?: (state: NodaroConnectionState, attempt: number) => void
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function registerNodaroCloudProviderWithRetry({
  delaysMs = NODARO_REGISTRATION_RETRY_DELAYS_MS,
  sleep = defaultSleep,
  onAttempt,
}: RegisterWithRetryOptions = {}): Promise<boolean> {
  if (providerRegistry.getProvider(NODARO_PROVIDER_ID)) return true

  let lastReason = ""
  for (let attempt = 0; ; attempt++) {
    const result = await readNodaroConnectionState()
    onAttempt?.(result, attempt)

    if (result.state === "connected") {
      if (!providerRegistry.getProvider(NODARO_PROVIDER_ID)) registerNodaroCloudProvider()
      console.log(`[providers] nodaro.ai cloud connection registered (attempt ${attempt + 1})`)
      return true
    }
    if (result.state === "not-connected") return false

    lastReason = result.reason
    if (attempt >= delaysMs.length) break
    await sleep(delaysMs[attempt])
    // Something else (the router self-heal) may have registered it meanwhile.
    if (providerRegistry.getProvider(NODARO_PROVIDER_ID)) return true
  }

  console.warn(
    `[providers] could not read the nodaro.ai connection after ${delaysMs.length + 1} attempts (${lastReason}) — ` +
      `if this install is connected, routing will self-heal on the first job`,
  )
  return false
}
