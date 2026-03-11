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

import { registerKieProviders } from "./kie/index.js"
// Replicate disabled — KIE.ai is the sole provider
// import { registerReplicateProviders } from "./replicate/index.js"

let initialized = false

export function initProviders(): void {
  if (initialized) return

  registerKieProviders()
  // Replicate disabled — KIE.ai is the sole provider
  // registerReplicateProviders()

  initialized = true
  console.log("[providers] All providers registered")
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
  generateMusic,
  textToSpeech,
} from "./router.js"
