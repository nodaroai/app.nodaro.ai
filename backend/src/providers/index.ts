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
import {
  NODARO_PROVIDER_ID,
  registerNodaroCloudProviderIfConnected,
  registerNodaroCloudProviderWithRetry,
} from "./nodaro/index.js"
import { providerRegistry } from "./registry.js"
import { resolveProviderKey, subscribeProviderKeys, type ProviderKeyId } from "../lib/provider-keys-runtime.js"
import { loadProviderCredentials, refreshProviderCredentialsIfStale, PROVIDER_CREDENTIALS_TTL_MS } from "../lib/provider-credentials.js"

let initialized = false
let nodaroRegistration: Promise<void> = Promise.resolve()

/**
 * Registry providers whose presence follows a key. Direct-call providers
 * (Anthropic, Gemini, ElevenLabs, fal) are not registry entries — their
 * clients read the live key per call, nothing to (un)register.
 */
const KEYED_REGISTRY_PROVIDERS: Partial<Record<ProviderKeyId, { register: () => void | Promise<unknown> }>> = {
  kie: { register: registerKieProviders },
  replicate: { register: registerReplicateProviders },
  nodaro: { register: registerNodaroCloudProviderIfConnected },
}

/**
 * Bring the registry in line with the keys in force for `changed` ids:
 * register a provider whose key appeared and unregister one whose key went
 * away — no restart. Hooked to the runtime's change events (a paste on
 * /setup in this process, or the encrypted store loading / refreshing).
 */
export async function reconcileProviders(changed: ReadonlyArray<ProviderKeyId>): Promise<void> {
  for (const id of changed) {
    const entry = KEYED_REGISTRY_PROVIDERS[id]
    if (!entry) continue
    const has = resolveProviderKey(id) !== null
    const registered = providerRegistry.getProvider(id === "nodaro" ? NODARO_PROVIDER_ID : id) !== null
    if (has && !registered) {
      try {
        await entry.register()
        console.log(`[providers] ${id} registered (key now present)`)
      } catch (err) {
        console.error(`[providers] ${id} registration failed:`, err)
      }
    } else if (!has && registered) {
      providerRegistry.unregister(id === "nodaro" ? NODARO_PROVIDER_ID : id)
      console.log(`[providers] ${id} unregistered (key removed)`)
    }
  }
}

let credentialsWatch: ReturnType<typeof setInterval> | null = null

/**
 * The poll runs at a fraction of the TTL: a tick that lands a few ms before
 * the snapshot turns stale must not push the next read a whole period out
 * (with tick == TTL, timer drift skipped every other tick — a 60 s pickup
 * for a 30 s TTL). Worst-case passive pickup is TTL + one tick.
 */
export const PROVIDER_CREDENTIALS_POLL_MS = Math.max(1_000, Math.floor(PROVIDER_CREDENTIALS_TTL_MS / 3))

/**
 * Load the operator-supplied keys and keep them fresh. Call once per process
 * after initProviders(): applies the encrypted store's snapshot (registering
 * whatever it unlocks) and re-reads it on the TTL so the worker sees what
 * the API process saved. The reconcile is returned to the runtime so a
 * caller awaiting `applyAppSnapshot` (the router's self-heal) continues only
 * once the registry reflects the new keys.
 */
export function watchProviderCredentials(): void {
  if (credentialsWatch) return
  subscribeProviderKeys((changed) => reconcileProviders(changed))
  void loadProviderCredentials()
  credentialsWatch = setInterval(() => {
    void refreshProviderCredentialsIfStale()
  }, PROVIDER_CREDENTIALS_POLL_MS)
  credentialsWatch.unref?.()
}

export function _resetProviderCredentialsWatchForTests(): void {
  if (credentialsWatch) clearInterval(credentialsWatch)
  credentialsWatch = null
}

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
  // fire-and-forget to keep this boot path synchronous. On the community
  // stack that read goes through the container's own Caddy, which start.sh
  // starts AFTER the workers, so the first attempt fails by construction;
  // the retry keeps trying for ~1 minute while the store is unreachable and
  // stops the moment it reads a definitive answer. providersReady() settles
  // after the FIRST attempt (retries continue detached) so no boot sequence
  // waits on the window. A store that never answers only means the cloud
  // fallback stays unregistered — local providers are unaffected.
  let firstAttemptDone: () => void = () => {}
  nodaroRegistration = new Promise<void>((resolve) => {
    firstAttemptDone = resolve
  })
  void registerNodaroCloudProviderWithRetry({ onAttempt: () => firstAttemptDone() })
    .catch((err) => {
      console.error("[providers] Nodaro Cloud provider registration failed:", err)
    })
    .finally(() => firstAttemptDone())

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
