import { VIDEO_ANALYSIS_AUDIO_MODES, type AudioLayer as AnalyzedAudioLayer } from "@nodaro/shared"

import type { VoiceDirection, VoiceDirectionKind } from "../voice-direction"

/**
 * The document's audio cues ↔ the `/` direction chips (spec D3, D5). The
 * format's `mode` IS the chip's `kind` — the analyzer's own vocabulary, plus
 * studio's `tone` — so this module is a RENAME, never a translation:
 * `directionsFromAudio` / `audioFromDirections` invert each other on
 * well-formed input, and `voice` / `speaker` only ever survive a `speech` cue
 * in either direction. The cue's TYPES live here too (R68), next to the one
 * mapping that reads them.
 *
 * BROWSER-FREE: `voice-direction.ts` is imported for TYPES only, and
 * `@nodaro/shared` is itself browser-free (`registry.ts` already value-imports
 * it), so nothing that would keep this module out of the registry closure
 * reaches it.
 */

/** The `/` audio cue's document vocabulary (plan-import-v2 D3, R68) — the
 *  platform's own analyzer modes ({@link VIDEO_ANALYSIS_AUDIO_MODES}, the
 *  recast script's vocabulary), plus studio's `tone`: a DELIVERY note
 *  ("[whispered]", "[dry]") that belongs to a spoken line rather than to a
 *  layer of the mix, so an analysis never emits it and it stays local. Kept as
 *  studio's OWN ordered list rather than derived from the shared one: it is
 *  what both published schemas enumerate, and a mode added upstream must fail
 *  the guards (below and in `json-schema.audio.test.ts`) rather than slip
 *  silently into the contract. */
export const AUDIO_MODES = ["speech", "tone", "sfx", "ambience", "music"] as const
export type AudioMode = AnalyzedAudioLayer["mode"] | "tone"

/** One concurrent sound cue on a shot, or on a shot-less scene's motion (D3,
 *  D5) — the platform's own {@link AnalyzedAudioLayer}, with `mode` widened by
 *  studio's `tone` and `speakerSlot` dropped: an analysis addresses a speaker
 *  by ENTITY SLOT id, this format by NAME, so `speaker` is the only spelling
 *  the schemas and the chips carry. Derived rather than restated (R68), so a
 *  field the platform adds lands in `Required<AudioLayer>` — and fails the
 *  coverage guard — instead of quietly going unread.
 *  `voice` / `speaker` are speech-only: they mean nothing on any other mode. */
export type AudioLayer = Omit<AnalyzedAudioLayer, "mode" | "speakerSlot"> & {
  mode: AudioMode
}

// The format's modes ARE the chip kinds — pinned at compile time, so the two
// vocabularies can never drift apart.
const _modesAreKinds: ReadonlyArray<VoiceDirectionKind> = AUDIO_MODES
void _modesAreKinds

// …and they ARE the analyzer's modes plus `tone`, pinned in BOTH directions
// (R68): a member this list carries that the union doesn't fails the first, a
// mode `@nodaro/shared` adds that this list lacks fails the second.
const _listIsInUnion: ReadonlyArray<AudioMode> = AUDIO_MODES
const _unionIsInList: ReadonlyArray<(typeof AUDIO_MODES)[number]> = [
  ...VIDEO_ANALYSIS_AUDIO_MODES,
  "tone",
]
void _listIsInUnion
void _unionIsInList

const MODES: ReadonlySet<string> = new Set(AUDIO_MODES)

/** Whether a raw document value is one of THIS format's audio modes — the
 *  lenient schema accepts any string (D13), so repair checks the vocabulary. */
export function isAudioMode(value: unknown): value is AudioMode {
  return typeof value === "string" && MODES.has(value)
}

/** Document cues → chips, in document order. */
export function directionsFromAudio(
  layers: ReadonlyArray<AudioLayer> | undefined,
): VoiceDirection[] {
  return (layers ?? []).map((l) => ({
    kind: l.mode,
    text: l.content,
    ...(l.mode === "speech" && l.speaker ? { speaker: l.speaker } : {}),
    ...(l.mode === "speech" && l.voice ? { voice: l.voice } : {}),
  }))
}

/** Chips → document cues, in chip order; `undefined` when there are none
 *  (omit-when-empty, matching every other optional field in the format). */
export function audioFromDirections(
  directions: ReadonlyArray<VoiceDirection> | undefined,
): AudioLayer[] | undefined {
  const out = (directions ?? []).map((d) => ({
    mode: d.kind,
    content: d.text,
    ...(d.kind === "speech" && d.voice ? { voice: d.voice } : {}),
    ...(d.kind === "speech" && d.speaker ? { speaker: d.speaker } : {}),
  }))
  return out.length > 0 ? out : undefined
}
