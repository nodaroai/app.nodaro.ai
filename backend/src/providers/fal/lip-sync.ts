/**
 * fal.ai Lip-Sync Provider — standalone wiring for the lip-sync subsystem.
 *
 * Mirrors `replicate/lip-sync.ts::replicateLipSync` + `LIP_SYNC_MODEL_CONFIGS`:
 * the lip-sync subsystem does NOT route non-KIE models through the
 * ProviderRegistry, so each backing provider exposes a flat function that the
 * `handleLipSync` worker branch calls directly.
 *
 * Anchor model: `sync-lipsync-v3` → fal endpoint `fal-ai/sync-lipsync/v3`
 * (video+audio → video; dub existing footage). Verified schema:
 *   video_url (req), audio_url (req), sync_mode (cut_off|loop|bounce|silence|remap),
 *   options.active_speaker_detection { auto_detect, v3 } (the only sync-3 option that
 *   is not managed natively — see fal's Sync3GenerationOptions).
 */

import { runFalRequest, extractFalUrl } from "./client.js"
import { falCostUsd } from "./pricing.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { applyProviderSafety } from "../../lib/provider-safety.js"
import type { SafetyLever } from "../safety-levers.js"
import type { ProviderSafetyEntry } from "../kie/models.js"

interface FalLipSyncConfig {
  /** fal endpoint slug (the slashed id never leaves this registry). */
  endpoint: string
  /** Input field name for the source video URL. */
  videoParam: string
  /** Input field name for the driving audio URL. */
  audioParam: string
  /** The model's content-filter settings, as its schema exposes them. */
  safetyLevers?: readonly SafetyLever[]
}

export const FAL_LIP_SYNC_CONFIGS: Record<string, FalLipSyncConfig> = {
  "sync-lipsync-v3": {
    endpoint: "fal-ai/sync-lipsync/v3",
    videoParam: "video_url",
    audioParam: "audio_url",
    // Works from a real person's face and footage: never loosened.
    safetyLevers: [{ kind: "boolean", param: "enable_safety_checker", filterOnValue: true, shipped: null, providerDefault: true, neverLoosen: true }],
  },
}

export interface FalLipSyncParams {
  /** sync_mode enum: cut_off | loop | bounce | silence | remap (fal default cut_off). */
  syncMode?: string
  /**
   * Client-supplied output duration (seconds) used ONLY to compute the anomaly/
   * display `cost`. Absent (or ≤ 0) → the 300s ceiling, mirroring
   * `buildLipSyncCreditId`, so `provider_cost` is never written as $0.
   */
  audioDurationSec?: number
  /**
   * Active speaker detection — the ONE sync-3 option that is not managed natively
   * (temperature / occlusion / reasoning are ignored by sync-3). `true` asks fal for
   * sync.so's auto-detect with the v3 detector, so a multi-person clip animates
   * whoever is speaking instead of one arbitrary face. Off by default upstream,
   * and absent here ⇒ no `options` key at all (today's request, byte for byte).
   * The route already accepts `activeSpeaker`; this is where it reaches fal.
   */
  activeSpeaker?: boolean
}

/**
 * Run a fal lip-sync request. Builds the endpoint input from the per-model
 * config, dispatches through the shared fal queue envelope, and returns the
 * extracted video URL plus a raw provider USD cost (anomaly/display only — the
 * credit charge is the reserved bucket, never this value).
 */
export async function falLipSync(
  provider: string,
  videoUrl: string,
  audioUrl: string,
  params: FalLipSyncParams = {},
  reconcileOpts?: ReconcileOpts,
): Promise<{ videoUrl: string; cost: number | null }> {
  const cfg = FAL_LIP_SYNC_CONFIGS[provider]
  if (!cfg) {
    throw new Error(`Unsupported fal lip-sync provider: ${provider}`)
  }

  const input: Record<string, unknown> = {
    [cfg.videoParam]: videoUrl,
    [cfg.audioParam]: audioUrl,
    ...(params.syncMode ? { sync_mode: params.syncMode } : {}),
    ...(params.activeSpeaker
      ? { options: { active_speaker_detection: { auto_detect: true, v3: true } } }
      : {}),
  }

  const { output } = await runFalRequest({
    endpoint: cfg.endpoint,
    input: await applyProviderSafety(falLipSyncSafetyEntry(provider), input),
    label: "[fal:lipSync]",
    reconcileOpts,
  })

  const videoUrlOut = extractFalUrl(output)

  // Cost falls back to the 300s ceiling when no duration is supplied so the
  // written provider_cost reflects the worst case (mirrors buildLipSyncCreditId),
  // not
  const seconds =
    params.audioDurationSec && params.audioDurationSec > 0 ? params.audioDurationSec : 300
  const cost = falCostUsd(provider, { seconds })

  return { videoUrl: videoUrlOut, cost }
}

/** fal's lip-sync models with a content-filter lever, as the admin page and the chokepoint read them. */
export function falSafetyEntries(): readonly ProviderSafetyEntry[] {
  return Object.entries(FAL_LIP_SYNC_CONFIGS).flatMap(([modelId, cfg]) =>
    cfg.safetyLevers?.length ? [{ modelId, wireModel: cfg.endpoint, levers: cfg.safetyLevers }] : [],
  )
}

function falLipSyncSafetyEntry(modelId: string): ProviderSafetyEntry | null {
  return falSafetyEntries().find((e) => e.modelId === modelId) ?? null
}
