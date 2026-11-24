/**
 * LTX 2.5 Fast on the Lip Sync node (decided 2026-11-23): a portrait and the
 * voice line make a talking clip as long as the voice, on the model's
 * audio-to-video endpoint. It is Generate Video's audio-to-video run with the
 * portrait as its start frame, so it is priced, measured and sent by the SAME
 * rule (`driving-audio.ts`: the measured voice rounded up to a whole second,
 * one row per second, the length sent a margin under the voice) — never by
 * Lip Sync's per-second rate or length buckets, which cannot reproduce those
 * rows. This file only says which Lip Sync models run that way and at which
 * resolution.
 */
import { MODEL_CATALOG } from "./model-catalog.js"
import { LIP_SYNC_PROVIDERS, SEEDANCE_LIP_SYNC_PROVIDERS, isLtx25Provider, normalizeLtx25Resolution } from "./model-constants.js"
import { takesDrivingAudio } from "./driving-audio.js"

/** Is this Lip Sync model an audio-to-video run (a Lip Sync model whose catalog entry has `drivingAudio`)? */
export function isDrivingAudioLipSyncProvider(provider: unknown): provider is string {
  return typeof provider === "string" && (LIP_SYNC_PROVIDERS as readonly string[]).includes(provider) && takesDrivingAudio(provider)
}

/** The resolution a Lip Sync run uses when none is asked: the node's own default. */
const LIP_SYNC_DEFAULT_RESOLUTION = "720p"

/**
 * The resolution such a run is sent and priced at: the node's default (720p)
 * when none is asked, the one asked when the model renders it, else the one
 * the model renders for it (LTX 2.5: 1080p, as on Generate Video).
 */
export function drivingAudioLipSyncResolution(provider: string, resolution?: unknown): string {
  const asked = typeof resolution === "string" && resolution !== "" ? resolution : LIP_SYNC_DEFAULT_RESOLUTION
  if ((MODEL_CATALOG[provider]?.resolutions ?? []).includes(asked)) return asked
  return isLtx25Provider(provider) ? normalizeLtx25Resolution(provider, asked) : asked
}

/**
 * The Lip Sync models that make a NEW clip from a portrait and a voice line
 * (rather than dubbing a video or animating an avatar on its own lane): the
 * multimodal video models the node sends the voice as reference audio
 * (`SEEDANCE_LIP_SYNC_PROVIDERS`: the Seedance 2 family, MiniMax Hailuo 3)
 * and the ones that run audio-to-video (`isDrivingAudioLipSyncProvider`:
 * LTX 2.5 Fast), in the node's own order. The one list a product reads
 * instead of re-deriving it (decided 2026-11-24).
 */
export function portraitVideoLipSyncModels(): readonly string[] {
  return LIP_SYNC_PROVIDERS.filter((id) => SEEDANCE_LIP_SYNC_PROVIDERS.has(id) || isDrivingAudioLipSyncProvider(id))
}
