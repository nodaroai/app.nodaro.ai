/**
 * Replicate Audio Separation Provider — Demucs (Meta HT-Demucs v4).
 *
 * Separates ANY audio into vocal+instrumental (two-stems) or full per-source
 * stems. Wraps `ryan5453/demucs` (pinned version below; live-verified
 * 2026-06-19). cjwbw/demucs was rejected: its typed output has no
 * instrumental/no_vocals key, so it can't produce Vocal/Instrumental in one
 * call.
 *
 * Vocal/Instrumental mode → `stem:"vocals"` → output `{ vocals, no_vocals }`
 *   (no_vocals = instrumental).
 * Full stems mode → `stem:"none"` → `{ vocals, drums, bass, other (+guitar,
 *   piano on htdemucs_6s) }`.
 *
 * Pricing is FIXED (reserved tier committed verbatim), so the predict-time
 * `cost` is display-only and the Demucs GPU SKU is billing-irrelevant.
 */

import type {
  AudioSeparationProvider,
  AudioSeparationResult,
  ReconcileOpts,
} from "../provider.interface.js"
import { runReplicatePrediction, extractUrl } from "./client.js"

/** Pinned ryan5453/demucs version (live-verified 2026-06-19). */
const DEMUCS_VERSION =
  "5a7041cc9b82e5a558fea6b3d7b12dea89625e89da33f0447bd727c2d0ab9e77"

// Cap concurrent Demucs calls. Replicate cold-starts/rate-limits concurrent
// separations hard: a single run is ~8s, but several at once queue for MINUTES
// and throw 502s (prod incident 2026-06-22 — 4 concurrent voice-changer-pro jobs
// each ran 4-8 min + one 502). always-split means EVERY recast job hits Demucs,
// so concurrency is now the norm. A small FIFO pool serializes them so each runs
// at its fast solo speed instead of all stalling. Process-local (per worker).
const MAX_CONCURRENT_SEPARATIONS = 2
let activeSeparations = 0
const separationQueue: Array<() => void> = []
function acquireSeparationSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      activeSeparations++
      resolve(() => {
        activeSeparations--
        separationQueue.shift()?.()
      })
    }
    if (activeSeparations < MAX_CONCURRENT_SEPARATIONS) grant()
    else separationQueue.push(grant)
  })
}

/** Retry Demucs on transient Replicate gateway errors (Cloudflare 502/503/504,
 *  connection resets, DNS) — not real failures; a retry with backoff succeeds. */
async function runDemucsWithRetry(
  args: Parameters<typeof runReplicatePrediction>[0],
  attempts = 3,
): ReturnType<typeof runReplicatePrediction> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await runReplicatePrediction(args)
    } catch (err) {
      lastErr = err
      const msg = String((err as { message?: string })?.message ?? err)
      const transient = /\b50[234]\b|bad gateway|gateway time|ECONNRESET|EAI_AGAIN|ETIMEDOUT|socket hang up/i.test(msg)
      if (!transient || i === attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
  throw lastErr
}

type SeparationMode = "vocal_instrumental" | "stems"
type SeparationQuality = "auto" | "fast" | "best"

type StemField = Exclude<keyof AudioSeparationResult, "cost">

/** Demucs output key → canonical result field. `no_vocals` is the instrumental. */
const STEM_KEY_MAP: Record<string, StemField> = {
  vocals: "vocals",
  no_vocals: "instrumental",
  instrumental: "instrumental",
  drums: "drums",
  bass: "bass",
  other: "other",
  guitar: "guitar",
  piano: "piano",
}

/** Pick the Demucs model variant for (mode, quality). */
function pickModel(mode: SeparationMode, quality: SeparationQuality): string {
  if (mode === "stems") {
    // Full stems: htdemucs_6s (6 stems incl. guitar/piano) for auto/best;
    // htdemucs (4 stems) for fast. htdemucs_ft is 4-stem-only, so "best" must
    // NOT downgrade the stem count (would be charge-more-get-fewer).
    return quality === "fast" ? "htdemucs" : "htdemucs_6s"
  }
  // Vocal/Instrumental (two-stem): fine-tuned for best, base otherwise.
  return quality === "best" ? "htdemucs_ft" : "htdemucs"
}

export class ReplicateAudioSeparationProvider implements AudioSeparationProvider {
  async separateAudio(
    audioUrl: string,
    opts: { mode: SeparationMode; quality: SeparationQuality },
    _reconcileOpts?: ReconcileOpts,
  ): Promise<AudioSeparationResult> {
    const input: Record<string, unknown> = {
      audio: audioUrl,
      model: pickModel(opts.mode, opts.quality),
      stem: opts.mode === "vocal_instrumental" ? "vocals" : "none",
      output_format: "mp3",
    }

    // Intentionally NO reconcileOpts/onTaskCreated: a crashed job fails+refunds
    // rather than being single-URL reconcile-recovered (which would flatten the
    // stems to one mediaUrl). See design §C(c).
    // Throttle + retry: concurrent Demucs calls otherwise hammer Replicate
    // (minutes + 502s under load). Serialize to a small pool, retry transient 5xx.
    const releaseSlot = await acquireSeparationSlot()
    let prediction: Awaited<ReturnType<typeof runReplicatePrediction>>
    try {
      prediction = await runDemucsWithRetry({
        version: DEMUCS_VERSION,
        input,
        label: "Audio separation",
        costModelKey: "demucs",
      })
    } finally {
      releaseSlot()
    }
    const { output, cost } = prediction

    if (!output || typeof output !== "object") {
      throw new Error("Demucs returned no output")
    }

    const result: AudioSeparationResult = { cost }
    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      const field = STEM_KEY_MAP[key]
      if (field && value != null) {
        result[field] = extractUrl(value)
      }
    }

    // `cost` is always present; any additional key means at least one stem
    // mapped. Derived from the result (not a hand-maintained stem subset) so it
    // can't drift as stems are added.
    if (Object.keys(result).length <= 1) {
      throw new Error(
        `Demucs output had no recognized stems: ${Object.keys(output as object).join(", ")}`,
      )
    }
    return result
  }
}
