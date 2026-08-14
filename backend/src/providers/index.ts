/**
 * Provider System Entry Point
 *
 * Call `initProviders()` once at server startup to register all
 * providers with the registry. After that, import the typed
 * operation functions from ./router.ts.
 *
 * Usage:
 *   import { initProviders } from "./providers/index.js"
 *   await initProviders()
 *
 *   import { generateImage, imageToVideo } from "./providers/router.js"
 *   const result = await generateImage("a cat", "nano-banana")
 */

import { config } from "../lib/config.js"
import { registerKieProviders } from "./kie/index.js"
import { registerReplicateProviders } from "./replicate/index.js"
import { registerNodaroCloudProviderIfConnected } from "./nodaro/index.js"

let initialized = false
let nodaroRegistration: Promise<void> = Promise.resolve()

export function initProviders(): void {
  if (initialized) return

  // Key-aware registration (Phase 4b follow-up, needed for cloud-connect):
  // a KEYLESS self-host that registers KIE would still CLAIM every model KIE
  // declares and then fail each call with a missing-key error — blocking the
  // nodaro fallthrough entirely (the router skips UNREGISTERED providers,
  // not registered-but-keyless ones). Cloud/keyed installs are unchanged.
  if (config.KIE_API_KEY) {
    registerKieProviders()
  } else {
    console.warn("[providers] KIE_API_KEY not set — KIE providers not registered")
  }
  // Replicate is registered for a narrow set of "Open" (uncensored) image
  // models — see providers/replicate/image.ts. KIE wins the chain for every
  // model it declares; Replicate is the fallthrough.
  if (config.REPLICATE_API_TOKEN) {
    registerReplicateProviders()
  } else {
    console.warn("[providers] REPLICATE_API_TOKEN not set — Replicate providers not registered")
  }

  // Nodaro Cloud (community cloud-connect): registered ONLY when the instance
  // holds a cloud token — an async DB read, so it is kicked off here
  // fire-and-forget to keep this boot path synchronous. Until it settles (one
  // Supabase read, typically well before the first job is consumed) routing
  // behaves as "not connected"; a check failure only means the cloud fallback
  // stays unregistered — local providers are unaffected.
  nodaroRegistration = registerNodaroCloudProviderIfConnected()
    .then(() => undefined)
    .catch((err) => {
      console.error("[providers] Nodaro Cloud provider registration failed:", err)
    })

  initialized = true
  console.log("[providers] All providers registered")
}

/**
 * Settles once the conditional (async) Nodaro Cloud registration has
 * finished — await point for tests and boot sequences that need the final
 * provider roster.
 */
export function providersReady(): Promise<void> {
  return nodaroRegistration
}

// Re-export public API so consumers can import from "providers"
export { providerRegistry } from "./registry.js"
export type {
  ProviderCapability,
  ProviderResult,
  ProviderInfo,
  ProviderOptions,
} from "./provider.interface.js"
export type { RouteResult } from "./router.js"
export type { ProviderUsed, RoutingDecision } from "./config.js"

// Re-export typed operation functions
export {
  generateImage,
  editImage,
  imageToVideo,
  textToVideo,
  videoToVideo,
  motionTransfer,
  videoUpscale,
  lipSync,
  lipSyncVideo,
  speechToVideo,
  generateMusic,
  textToSpeech,
} from "./router.js"
