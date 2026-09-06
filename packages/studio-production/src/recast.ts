import type { AudioFxPreset } from "@nodaro/shared"

/**
 * Character-Voice recast (voice-changer-pro / `voices.recast`). After a clip renders
 * with the model's NATIVE audio, the platform's multi-speaker voice changer recasts
 * each detected speaker into a chosen voice — `orderedVoices[0]` is the FIRST speaker
 * to talk, `[1]` the second, and so on; speakers past the list keep their voice.
 *
 * These types ride the Directing submit and persist on the clip so a re-edit restores
 * the same recast. The settings are PER-SHOT (a production's shots can differ) with
 * sensible defaults — a user who doesn't care never touches them.
 */

/**
 * Per-voice ElevenLabs speech-to-speech settings — the SAME levers (and
 * defaults) the dedicated Voice Changer Pro app exposes per speaker. Every
 * field optional; {@link pruneVoiceSettings} drops values equal to the
 * defaults so an untouched voice rides the wire as a bare voice id.
 */
export interface RecastVoiceSettings {
  /** Stability (0–1). Higher = steadier, lower = more expressive. */
  readonly stability?: number
  /** Similarity boost (0–1) — how closely the output hugs the target timbre. */
  readonly similarityBoost?: number
  /** Style exaggeration (0–1). Default 0; >0 amplifies delivery. */
  readonly style?: number
  /** Speaker boost — sharpens fidelity to the target speaker (default on). */
  readonly useSpeakerBoost?: boolean
  /** Deterministic seed (0–4294967295) — same source + settings + seed
   *  reproduces this speaker's recast. Omit for random. */
  readonly seed?: number
  /** Loudness: "match" the original speaker (default) | "normalize" | "manual". */
  readonly volumeMode?: "match" | "normalize" | "manual"
  /** Manual output volume % (0–200) — only when volumeMode === "manual". */
  readonly volume?: number
}

/** The per-voice defaults (mirrors the VCP app / platform node defaults). */
export const RECAST_VOICE_DEFAULTS = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  volumeMode: "match" as const,
  volume: 100,
}

/**
 * One SPEAKER SLOT in the ordered recast — the @-referenced character's saved
 * voice, plus the user's per-slot choices: `keep` turns the slot into a
 * KEEP-SLOT (the wire's `null` — that speaker keeps their original voice while
 * later speakers are still recast), and `settings` pins per-voice
 * speech-to-speech levers.
 */
export interface RecastVoice {
  readonly voiceId: string
  readonly voiceName: string
  /** True = this speaker KEEPS their original voice (wire: a `null` slot). */
  readonly keep?: boolean
  /** Pruned per-voice levers (absent = all defaults → a bare-id wire entry). */
  readonly settings?: RecastVoiceSettings
}

/** A reverb/echo effect on the COMBINED recast voices (before the music is mixed back). */
export interface RecastVoiceFx {
  readonly preset: AudioFxPreset
  readonly wetDryMix?: number
  readonly delayMs?: number
  readonly decay?: number
}

/** Per-shot voice-changer-pro settings (curated; all optional via {@link DEFAULT_RECAST_SETTINGS}). */
export interface RecastSettings {
  /** Mix the separated music/SFX stem back under the new voices (default true). */
  readonly preserveBackground: boolean
  /** Demucs split model: "fast" (htdemucs, preserves more voice) | "best" (htdemucs_ft). */
  readonly separationQuality: "fast" | "best"
  /** Preserved-background level: "match" (default) | "normalize" | "manual". */
  readonly musicVolumeMode: "match" | "normalize" | "manual"
  /** Background level % (0–200) — only when musicVolumeMode === "manual". */
  readonly musicVolume?: number
  /** Reverb/echo on the recast voices, or undefined for none. */
  readonly voiceFx?: RecastVoiceFx
  /** Speech-to-speech model id, or undefined for the server default. */
  readonly model?: string
  /** Strip background noise for a cleaner voice result (default off). */
  readonly removeBackgroundNoise?: boolean
}

/** The Character-Voice recast plan — speaker-ordered voices + the per-shot settings. */
export interface RecastPlan {
  readonly orderedVoices: ReadonlyArray<RecastVoice>
  readonly settings: RecastSettings
}

/** Defaults matching the platform node, so an untouched recast "just works". */
export const DEFAULT_RECAST_SETTINGS: RecastSettings = {
  preserveBackground: true,
  separationQuality: "fast",
  musicVolumeMode: "match",
}

/**
 * Drop per-voice values equal to the defaults (the VCP app's prune pattern) —
 * an untouched popover yields `undefined`, which keeps the wire entry a bare
 * voice id. `volume` only matters in manual mode, so it prunes with it.
 */
export function pruneVoiceSettings(
  s: RecastVoiceSettings,
): RecastVoiceSettings | undefined {
  const d = RECAST_VOICE_DEFAULTS
  const manual = s.volumeMode === "manual"
  const out: RecastVoiceSettings = {
    ...(s.stability !== undefined && s.stability !== d.stability
      ? { stability: s.stability }
      : {}),
    ...(s.similarityBoost !== undefined && s.similarityBoost !== d.similarityBoost
      ? { similarityBoost: s.similarityBoost }
      : {}),
    ...(s.style !== undefined && s.style !== d.style ? { style: s.style } : {}),
    ...(s.useSpeakerBoost !== undefined && s.useSpeakerBoost !== d.useSpeakerBoost
      ? { useSpeakerBoost: s.useSpeakerBoost }
      : {}),
    ...(s.seed !== undefined ? { seed: s.seed } : {}),
    ...(s.volumeMode !== undefined && s.volumeMode !== d.volumeMode
      ? { volumeMode: s.volumeMode }
      : {}),
    ...(manual && s.volume !== undefined && s.volume !== d.volume
      ? { volume: s.volume }
      : {}),
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The `orderedVoices` wire array for `voices.recast`: a KEEP slot → `null`
 * (that speaker keeps their original voice — later speakers still recast), a
 * tuned voice → the per-voice settings object, an untouched voice → its bare
 * id. Mirrors the VCP app's `buildOrderedVoices`.
 */
export function buildWireOrderedVoices(
  orderedVoices: ReadonlyArray<RecastVoice>,
): Array<string | ({ voiceId: string } & RecastVoiceSettings) | null> {
  return orderedVoices.map((v) => {
    if (v.keep) return null
    const settings = v.settings ? pruneVoiceSettings(v.settings) : undefined
    return settings ? { voiceId: v.voiceId, ...settings } : v.voiceId
  })
}

/** The slots that actually RECAST (non-keep) — drives the has-work guard (the
 *  platform requires ≥1 non-null entry) and the clip's provenance label. */
export function recastActiveVoices(
  orderedVoices: ReadonlyArray<RecastVoice>,
): RecastVoice[] {
  return orderedVoices.filter((v) => !v.keep)
}
