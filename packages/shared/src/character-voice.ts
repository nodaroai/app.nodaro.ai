import type { TtsProvider } from "./model-constants.js"

/**
 * How the TTS layer resolves a voice id. Mirrors `CharacterVoice.voiceType` on
 * the frontend character node: `premade` voices resolve by NAME, `library` /
 * `custom` voices resolve by ID. Carry it alongside the id or premade-vs-library
 * resolution misroutes (see backend `direct-tts.ts`).
 */
export type VoiceType = "premade" | "library" | "custom"

/**
 * A character's saved voice as supplied to the voiced-video orchestration on
 * `POST /v1/generate-video`. A deliberate subset of the frontend `CharacterVoice`:
 * only the fields the server needs to synthesise speech (no `voiceName` /
 * `traits` / `previewUrl`, which are display-only and never read server-side).
 *
 * `speaker` is the join key: it matches a {@link DialogueLine}.speaker so a
 * multi-speaker prompt routes each line to its own voice. Omit it for a
 * single-voice clip (one spec, no dialogue attribution needed).
 */
export interface CharacterVoiceSpec {
  /** ElevenLabs voice id, or the premade voice NAME when `voiceType === "premade"`. */
  readonly voiceId: string
  /** How the TTS layer resolves {@link voiceId}. Defaults to `"premade"` downstream. */
  readonly voiceType?: VoiceType
  /** Recommended TTS provider for this voice; forwarded as `provider` to TTS. */
  readonly ttsProvider?: TtsProvider
  /**
   * Speaker label this voice belongs to (e.g. "Anna"). Joined to
   * {@link DialogueLine}.speaker case-insensitively (trimmed). Omit for a
   * single-voice clip.
   */
  readonly speaker?: string
}

/** One attributed line of dialogue: who speaks (`speaker`) and what they say (`line`). */
export interface DialogueLine {
  readonly speaker: string
  readonly line: string
}

/**
 * A dialogue line resolved to a concrete voice, in the exact shape the
 * ElevenLabs Dialogue v3 primitive (`POST /v1/text-to-dialogue`) consumes:
 * `{ text, voice }` per line, in order. `voiceType` rides along so the TTS layer
 * resolves premade-by-name vs library/custom-by-id correctly.
 */
export interface ResolvedDialogueVoiceLine {
  readonly text: string
  readonly voice: string
  readonly voiceType?: VoiceType
}

// Quote characters built from code points so this file stays pure ASCII. The
// published @nodaro/shared package must survive a re-save in any locale, and a
// literal curly quote or em-dash here is exactly the CP1255 mojibake hazard that
// has reached main before. RDQUO/LDQUO = curly double quotes, RAQUO/LAQUO =
// guillemets, RSQUO = right single quote (apostrophe inside a name like O'Brien).
const RDQUO = String.fromCharCode(0x201d)
const LDQUO = String.fromCharCode(0x201c)
const RAQUO = String.fromCharCode(0x00bb)
const LAQUO = String.fromCharCode(0x00ab)
const RSQUO = String.fromCharCode(0x2019)

/**
 * Matches one attributed, QUOTED line of dialogue. Built with `new RegExp` +
 * `String.raw` so the regex backslashes stay literal while the non-ASCII quote
 * characters are injected from the code-point consts above.
 *
 * - A leading boundary lookbehind (`^`, newline, sentence punctuation, or a
 *   CLOSING quote) keeps the speaker capture from bridging a sentence: e.g.
 *   "...kitchen. Anna: "hi"" yields speaker "Anna", not "kitchen. Anna", and the
 *   speaker after a closing quote ("hi" Gordon: "yo") is still found.
 * - Speaker = 1 to 4 short words (names are short; no "." inside a token).
 * - Body = the first quoted run in straight, curly, or guillemet quotes.
 *
 * Requiring quotes is what stops cinematic direction ("Setting: a forest",
 * "Camera: dolly in") from being read as dialogue.
 */
const ATTRIBUTED_DIALOGUE_RE = new RegExp(
  String.raw`(?<=^|[\n\r.!?;,"${RDQUO}${RAQUO}])\s*([\p{L}][\p{L}\p{N}'${RSQUO}-]*(?:\s+[\p{L}][\p{L}\p{N}'${RSQUO}-]*){0,3})\s*:\s*(?:"([^"]+)"|${LDQUO}([^${RDQUO}]+)${RDQUO}|${LAQUO}([^${RAQUO}]+)${RAQUO})`,
  "gu",
)

/**
 * Extract attributed dialogue (`Speaker: "line"`) from a free-text prompt.
 *
 * Deterministic and intentionally conservative (see {@link ATTRIBUTED_DIALOGUE_RE}):
 * only QUOTED lines attributed to a short speaker label are matched. Callers that
 * already have structured dialogue (studio prompt chips) should pass it directly
 * and skip this parser. Order is preserved (it drives the stitched dialogue
 * track). Returns `[]` when no attributed quoted dialogue is found.
 */
export function parseAttributedDialogue(prompt: string): DialogueLine[] {
  if (!prompt) return []
  const out: DialogueLine[] = []
  for (const m of prompt.matchAll(ATTRIBUTED_DIALOGUE_RE)) {
    const speaker = m[1]?.trim() ?? ""
    const line = (m[2] ?? m[3] ?? m[4] ?? "").trim()
    if (speaker && line) out.push({ speaker, line })
  }
  return out
}

/**
 * Resolve each dialogue line to a concrete voice by joining `line.speaker` to
 * `voices[].speaker` (case-insensitive, trimmed) - the "Speaker mapping" model.
 *
 * Fallback order for an unmatched / unattributed line: the matched speaker's
 * voice -> `defaultVoiceId` -> the sole voice (when exactly one spec is given) ->
 * the first voice. A line resolves to nothing only when there are no voices and
 * no default, in which case it is dropped (the caller decides whether an empty
 * result means "no dialogue to synthesise"). This mirrors the pipeline's
 * non-fatal missing-voice behaviour (`allowDefaultVoiceFallback`).
 */
export function resolveDialogueVoices(
  dialogue: readonly DialogueLine[],
  voices: readonly CharacterVoiceSpec[],
  defaultVoiceId?: string,
): ResolvedDialogueVoiceLine[] {
  const bySpeaker = new Map<string, CharacterVoiceSpec>()
  for (const v of voices) {
    const key = v.speaker?.trim().toLowerCase()
    if (key) bySpeaker.set(key, v)
  }
  const soleVoice = voices.length === 1 ? voices[0] : undefined
  const firstVoice = voices[0]

  const lineFor = (text: string, spec: CharacterVoiceSpec): ResolvedDialogueVoiceLine => ({
    text,
    voice: spec.voiceId,
    ...(spec.voiceType ? { voiceType: spec.voiceType } : {}),
  })

  const out: ResolvedDialogueVoiceLine[] = []
  for (const { speaker, line } of dialogue) {
    const text = line.trim()
    if (!text) continue
    const matched = bySpeaker.get(speaker.trim().toLowerCase())
    if (matched) {
      out.push(lineFor(text, matched))
    } else if (defaultVoiceId) {
      out.push({ text, voice: defaultVoiceId })
    } else if (soleVoice) {
      out.push(lineFor(text, soleVoice))
    } else if (firstVoice) {
      out.push(lineFor(text, firstVoice))
    }
  }
  return out
}
