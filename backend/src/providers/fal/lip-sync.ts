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
 *   video_url (req), audio_url (req), sync_mode (cut_off|loop|bounce|silence|remap).
 */

import { runFalRequest, extractFalUrl } from "./client.js"
import { falCostUsd } from "./pricing.js"
import type { ReconcileOpts } from "../provider.interface.js"

interface FalLipSyncConfig {
  /** fal endpoint slug (the slashed id never leaves this registry). */
  endpoint: string
  /** Input field name for the source video URL. */
  videoParam: string
  /** Input field name for the driving audio URL. */
  audioParam: string
}

export const FAL_LIP_SYNC_CONFIGS: Record<string, FalLipSyncConfig> = {
  "sync-lipsync-v3": {
    endpoint: "fal-ai/sync-lipsync/v3",
    videoParam: "video_url",
    audioParam: "audio_url",
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
  }

  const { output } = await runFalRequest({
    endpoint: cfg.endpoint,
    input,
    label: "[fal:lipSync]",
    reconcileOpts,
  })

  const videoUrlOut = extractFalUrl(output)

  // Cost falls back to the 300s ceiling when no duration is supplied so the
  // written provider_cost reflects the worst case (mirrors buildLipSyncCreditId),
  // not $0.
  const seconds =
    params.audioDurationSec && params.audioDurationSec > 0 ? params.audioDurationSec : 300
  const cost = falCostUsd(provider, { seconds })

  return { videoUrl: videoUrlOut, cost }
}
