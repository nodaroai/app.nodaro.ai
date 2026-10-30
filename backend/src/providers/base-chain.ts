/**
 * The base provider chain of each capability — which providers the router
 * asks, in order, before the Nodaro Cloud extension (config.ts) is added.
 * Synchronous and import-light, so a caller that only needs to know WHO
 * serves a model (concurrency-lane provider attribution) reads the same
 * chain the router walks without loading app settings.
 */

import type { ProviderCapability } from "./provider.interface.js"

/**
 * Capabilities that only KIE.ai supports (no Replicate fallback exists).
 * These operations have no fallback provider — the chain is always ["kie"].
 */
const KIE_ONLY_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set([
  "video-to-video",
  "motion-transfer",
  "lip-sync",
  "speech-to-video",
  "text-to-speech",
])

/**
 * Capabilities whose chain falls through to Replicate for the model ids it
 * declares (the router walks each provider's `supportedModels` and the first
 * provider that declares the id serves it — no fall-through on failure — so
 * an id KIE declares never reaches Replicate).
 *
 * image-to-video and text-to-video are here for the video models that live
 * only on Replicate (Kling 3 Omni; the LTX pair is intercepted by its own
 * handler before the router). They were missing: Replicate registered
 * kling-3-omni for image-to-video, the dispatch guard saw it registered, and
 * the chain never asked Replicate — every run failed at the router with
 * "not supported by any registered provider" (prod 2026-10-29).
 * `__tests__/provider-chain-reachability.test.ts` now fails a capability a
 * registered provider declares models for whose chain never reaches it —
 * which is why sound-effect and audio-separation are listed too: Replicate
 * alone declares their models (MMAudio, Demucs). Their routes call the
 * provider directly today, with no router wrapper, so the chain changes
 * nothing for them; listing them keeps the rule total rather than exempted.
 */
const KIE_THEN_REPLICATE_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set([
  "image-generation",
  "image-editing",
  "image-to-video",
  "text-to-video",
  "video-upscale",
  "sound-effect",
  "audio-separation",
])

/** The capability's chain before the Nodaro Cloud extension: KIE first, then Replicate where it serves models KIE does not. */
export function baseProviderChain(capability: ProviderCapability): string[] {
  return KIE_ONLY_CAPABILITIES.has(capability)
    ? ["kie"]
    : KIE_THEN_REPLICATE_CAPABILITIES.has(capability)
      ? ["kie", "replicate"]
      : ["kie"]
}
