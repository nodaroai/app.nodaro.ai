import { getVideoAudioCapability, type VideoAudioMode } from "@nodaro/shared"

/**
 * Model-aware voice/audio DIRECTION for the Directing prompt — the `/` chips.
 *
 * A direction is SEMANTIC (`{ kind, text }`), never model syntax: the editor
 * shows (and the graph persists) the neutral `[text]` form, and only at submit
 * does {@link renderDirectionsIntoPrompt} translate each one into the ACTIVE
 * video model's official audio syntax. Switching models therefore never
 * rewrites the user's prompt — the same chips simply render differently on the
 * next run. A fifth kind, `speech` (a spoken LINE, optionally cast with a
 * `speaker` and a `voice` note), joined `tone`/`sfx`/`ambience`/`music` in
 * plan-import-v2 (spec D4, §7.3) — it shares `tone`'s speech-capability gate
 * (a line needs a model that can speak it) but renders through its own
 * attribution grammar per family, below.
 *
 * Per-family syntax (research 2026-07-16, spec D15; speech grammar §7.3):
 *   - Seedance 2.x — official symbols: `<sfx / ambience>`, `（music）`,
 *     tone as prose ("spoken in a … tone"). Source: BytePlus ModelArk prompt
 *     guide via `@nodaro/prompts` PROVIDER_PROMPT_DOCTRINES.
 *   - VEO 3.x — official labels: `SFX: …`, `Ambient noise: …`, `Music: …`,
 *     parenthesised tone. Source: Google's Veo 3.1 prompting guide.
 *   - Kling 2.6/3.0 — NATIVE SPEECH since `@nodaro/shared@1.11.0` (platform
 *     probe-verified through KIE): the generic `Audio: …` clause + tone prose
 *     both apply; the official doctrine (Kling entry in
 *     PROVIDER_PROMPT_DOCTRINES, `@nodaro/prompts@1.2.0`) additionally
 *     supports `[Label: tone]: "line"` dialogue the USER writes in prose.
 *   - Other ambient-only models (Seedance 1.x) — the generic `Audio: …`
 *     clause; tone AND speech are UNSUPPORTED (their audio is SFX, not voice).
 *   - Silent models — every direction is dropped (reported via `dropped`).
 *   - Speech lines, every speech-capable family: Kling gets the bracketed
 *     casting form `[Who: cast]: "line"`; VEO gets Google's own attribution
 *     formula `Who (cast) says, "line"`; everyone else gets quoted dialogue
 *     inline, `Who (cast) says: "line"` — an absent speaker reads as
 *     "A voice", an absent cast note drops its parenthetical (or reads
 *     "natural voice" for Kling, whose bracket form always names one).
 *
 * Availability derives from the platform's `getVideoAudioCapability` (the
 * audio-capability SSOT in `@nodaro/shared`) — never a hardcoded model list.
 */

export type VoiceDirectionKind = "tone" | "sfx" | "ambience" | "music" | "speech"

export interface VoiceDirection {
  readonly kind: VoiceDirectionKind
  /** The semantic payload — for `speech`, the LINE itself. */
  readonly text: string
  /** `speech` only — WHO says it, as prose (a cast name). Absent = a bodiless voice. */
  readonly speaker?: string
  /** `speech` only — the casting / delivery note ("male, urgent"). */
  readonly voice?: string
}

/**
 * Every member of a string union, exactly once, in declaration order — the
 * same discipline `music-options.ts`'s own `allOf<T>` uses for `MUSIC_VOCALS`
 * (a small generic worth re-typing here rather than importing across two
 * unrelated domains): `Record<T, true>` fails `tsc` on a member the union
 * doesn't have AND on one it's missing, so {@link KIND_ORDER} below can never
 * silently drift from {@link VoiceDirectionKind} in either direction (B1).
 *
 * TWO copies is the agreed ceiling: a THIRD promotes both to a shared
 * `lib/exhaustive.ts` (G2 review). Re-typing four lines beats an import that
 * ties the sound vocabulary to the music one; a third domain means the helper
 * has outgrown that argument.
 */
function allOf<T extends string>(members: Record<T, true>): ReadonlyArray<T> {
  return Object.keys(members) as unknown as ReadonlyArray<T>
}

/** Display order of the kinds — speech (the line) and tone (its delivery) first, then the sound layers. */
const KIND_ORDER: ReadonlyArray<VoiceDirectionKind> = allOf<VoiceDirectionKind>({
  speech: true,
  tone: true,
  sfx: true,
  ambience: true,
  music: true,
})

/** Is this one of the chip KINDS? Derived from {@link KIND_ORDER} — the one
 *  list — so every reader (the persisted blob, the chip's node attrs) speaks
 *  the same vocabulary and a new kind needs no second hand-typed copy. */
export function isVoiceDirectionKind(value: unknown): value is VoiceDirectionKind {
  return KIND_ORDER.includes(value as VoiceDirectionKind)
}

/** Kinds that need a model that SPEAKS — `speech` (a line) and `tone` (how a line is delivered). */
const SPEECH_KINDS: ReadonlySet<VoiceDirectionKind> = new Set(["speech", "tone"])

/** The `/` picker catalog — curated presets per kind (free text also allowed). */
export const VOICE_DIRECTION_SECTIONS: ReadonlyArray<{
  readonly kind: VoiceDirectionKind
  readonly label: string
  readonly presets: ReadonlyArray<string>
}> = [
  {
    kind: "speech",
    label: "Speech",
    // No presets: a line is never a preset. The picker offers it as the custom
    // row for whatever was typed after the slash.
    presets: [],
  },
  {
    kind: "tone",
    label: "Tone",
    presets: [
      "whispering",
      "shouting",
      "calm and warm",
      "urgent",
      "playful",
      "sarcastic",
      "matter-of-fact",
      "trembling",
      "excited",
      "resigned",
    ],
  },
  {
    kind: "sfx",
    label: "Sound effect",
    presets: [
      "door creaks",
      "gunshot",
      "explosion",
      "applause",
      "thunder rumbles",
      "glass breaking",
      "footsteps",
      "siren wailing",
      "wind blowing",
      "crowd cheering",
      "phone ringing",
      "a beat of silence",
    ],
  },
  {
    kind: "ambience",
    label: "Ambience",
    presets: [
      "heavy rain",
      "city traffic",
      "forest birds",
      "ocean waves",
      "quiet room tone",
      "busy cafe chatter",
      "distant highway hum",
    ],
  },
  {
    kind: "music",
    label: "Music",
    presets: [
      "soft piano",
      "tense strings",
      "epic orchestral swell",
      "slow jazz piano",
      "lo-fi beat",
      "synthwave pulse",
      "solo cello",
    ],
  },
]

/** Preset text (lowercased) → its kind, for legacy-token recovery. */
const PRESET_KIND_BY_TEXT: ReadonlyMap<string, VoiceDirectionKind> = new Map(
  VOICE_DIRECTION_SECTIONS.flatMap((s) =>
    s.presets.map((p) => [p.toLowerCase(), s.kind] as const),
  ),
)

/**
 * The `/` directions to RESTORE for a clip result — the persisted semantic
 * list when the result carries one, else a best-effort RECOVERY for LEGACY
 * results (generated before the list was persisted, pre-2026-07-17): their
 * prompt still holds the neutral `[text]` tokens but the `{kind, text}` list
 * was dropped at save time. Any token whose content exactly matches a catalog
 * preset (case-insensitive) recovers with that preset's kind — picker presets
 * are the overwhelmingly common case, and a flat bracket token that IS a
 * preset string almost certainly was a chip. Free-text directions are not
 * guessable (their kind is gone) and stay plain text. Tokens recover in
 * prompt order (duplicates map to successive occurrences — the same
 * consumption order as `buildPromptDoc`), with each text VERBATIM so the
 * rebuilt chip's neutral form reproduces the prompt's exact span.
 */
export function restoreClipDirections(result: {
  readonly prompt?: string
  readonly directions?: ReadonlyArray<VoiceDirection>
}): ReadonlyArray<VoiceDirection> | undefined {
  if (result.directions?.length) return result.directions
  const prompt = result.prompt
  if (!prompt || !prompt.includes("[")) return undefined
  const recovered: VoiceDirection[] = []
  for (const match of prompt.matchAll(DIRECTION_BRACKET_RUN)) {
    const kind = PRESET_KIND_BY_TEXT.get(match[1].trim().toLowerCase())
    if (kind) recovered.push({ kind, text: match[1] })
  }
  return recovered.length > 0 ? recovered : undefined
}

/** {@link KIND_ORDER} minus the kinds that need a voice — ambient models' offer. */
const AMBIENT_KINDS: ReadonlyArray<VoiceDirectionKind> = KIND_ORDER.filter(
  (k) => !SPEECH_KINDS.has(k),
)

/**
 * `getVideoAudioCapability`'s four-value `VideoAudioMode` → the kinds that
 * mode can honor. Silent → none; ambient (Kling, Seedance 1.x) → the sound
 * layers but NOT speech or tone (no voice to direct); native-speech / audio-
 * driven (VEO, Seedance 2) → everything. A TOTAL map, not an if/else chain
 * with an unguarded final branch — the same discipline `registry.ts`'s
 * `MODEL_AUDIO` uses (R22, B1): a fifth `VideoAudioMode` added to
 * `@nodaro/shared` fails `tsc` here rather than silently offering every kind
 * to a model that cannot honor them all.
 */
const KINDS_FOR_MODE: Record<VideoAudioMode, ReadonlyArray<VoiceDirectionKind>> = {
  none: [],
  ambient: AMBIENT_KINDS,
  native_speech: KIND_ORDER,
  audio_driven: KIND_ORDER,
}

/**
 * Which direction kinds the model can honor — derived from the platform's
 * audio-capability map via {@link KINDS_FOR_MODE}.
 */
export function voiceDirectionKindsFor(
  provider: string | undefined,
): ReadonlyArray<VoiceDirectionKind> {
  return KINDS_FOR_MODE[getVideoAudioCapability(provider).mode]
}

/**
 * The neutral in-editor / persisted form — what the chip's `renderText` emits
 * into `plainText` and what the graph stores, model-agnostic by design.
 */
export function neutralDirectionText(direction: VoiceDirection): string {
  return `[${direction.text}]`
}

/**
 * {@link neutralDirectionText}'s own grammar as a matcher: one run of
 * non-bracket, non-newline characters between a single `[`/`]` pair — the ONE
 * source for what a neutral token LOOKS like (B2). `warnOrphanRuns`
 * (`production-format/import-repair-sound.ts`'s bracket-token receipt over a
 * shot's — or a shot-less scene's — finished prose) reads this SAME pattern
 * rather than re-typing the shape, so a change to the token spelling here can
 * never leave the receipt scanning a stale grammar. Global and safe to SHARE
 * across modules: every caller reads it through `String.prototype.matchAll`,
 * which constructs its own copy per call (the spec's `RegExpCreate` step), so
 * this one object's `lastIndex` is never mutated out from under another call.
 */
export const DIRECTION_BRACKET_RUN = /\[([^[\]\n]+)\]/g

/** "a" / "an" by the phrase's leading vowel — for the tone prose clause. */
function article(phrase: string): "a" | "an" {
  return /^[aeiou]/i.test(phrase.trim()) ? "an" : "a"
}

const SEEDANCE_2_PREFIX = "seedance-2"
const VEO_PREFIX = "veo"
const KLING_PREFIX = "kling"

/** A speech line in the model family's own attribution grammar (spec §7.3). */
function renderSpeech(direction: VoiceDirection, provider: string | undefined): string {
  const who = direction.speaker?.trim() || "A voice"
  const cast = direction.voice?.trim()
  const line = direction.text.trim()
  if (provider?.startsWith(KLING_PREFIX)) return `[${who}: ${cast || "natural voice"}]: "${line}"`
  const named = cast ? `${who} (${cast})` : who
  if (provider?.startsWith(VEO_PREFIX)) return `${named} says, "${line}"`
  return `${named} says: "${line}"`
}

/**
 * Render ONE direction into the model's official audio syntax, or `null` when
 * the model can't honor it (silent model, or speech/tone on an ambient-only
 * model). Family routing is by id prefix; the CAPABILITY gate is always the
 * catalog's.
 */
export function renderVoiceDirection(
  direction: VoiceDirection,
  provider: string | undefined,
): string | null {
  const mode = getVideoAudioCapability(provider).mode
  if (mode === "none") return null
  const speechCapable = mode === "native_speech" || mode === "audio_driven"
  if (SPEECH_KINDS.has(direction.kind) && !speechCapable) return null
  if (direction.kind === "speech") return renderSpeech(direction, provider)

  const text = direction.text.trim()
  const toneClause = `spoken in ${article(text)} ${text} tone`

  if (provider?.startsWith(SEEDANCE_2_PREFIX)) {
    switch (direction.kind) {
      case "sfx":
      case "ambience":
        return `<${text}>`
      case "music":
        return `（${text}）` // （…） full-width parens — the official music cue
      case "tone":
        return toneClause
    }
  }

  if (provider?.startsWith(VEO_PREFIX)) {
    switch (direction.kind) {
      case "sfx":
        return `SFX: ${text}.`
      case "ambience":
        return `Ambient noise: ${text}.`
      case "music":
        return `Music: ${text}.`
      case "tone":
        return `(${toneClause})`
    }
  }

  // Generic audio-capable fallback (Kling, Seedance 1.x, future audio models):
  // a plain "Audio:" clause reads well everywhere.
  switch (direction.kind) {
    case "sfx":
      return `Audio: ${text}.`
    case "ambience":
      return `Audio: ambient ${text}.`
    case "music":
      return `Audio: background music, ${text}.`
    case "tone":
      return toneClause
  }
}

/**
 * Narrow a persisted `directions` blob → the semantic list, or undefined when
 * nothing valid survives. The ONE reader — the graph (beats, results, markers)
 * and the plan both use it. Text is validated trimmed but kept RAW: the chip's
 * `[text]` token in the prose was built from the raw string.
 */
export function readVoiceDirections(value: unknown): VoiceDirection[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: VoiceDirection[] = []
  for (const d of value) {
    if (typeof d !== "object" || d === null) continue
    const rec = d as Record<string, unknown>
    const text = typeof rec.text === "string" && rec.text.trim() ? rec.text : ""
    if (!text) continue
    const kind = rec.kind
    if (!isVoiceDirectionKind(kind)) continue
    const speech = kind === "speech"
    const speaker = speech && typeof rec.speaker === "string" ? rec.speaker.trim() : ""
    const voice = speech && typeof rec.voice === "string" ? rec.voice.trim() : ""
    out.push({
      kind,
      text,
      ...(speaker ? { speaker } : {}),
      ...(voice ? { voice } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * Does a SHOT already carry this scene-level cue? An equal `kind` + `text`
 * among its own `directions` — the chips a split copies along with the prose,
 * which then ride the fold from the shot's entry instead of the scene's.
 *
 * SEMANTIC, never textual: a token sitting in a shot's prose with no chip
 * behind it (a split made before shots owned their cues, a paste) is NOT
 * ownership — nothing of the shot's would render it, so the scene's entry must
 * still be there. `speaker` / `voice` do not participate: the cue is the line.
 */
export function beatsOwnDirection(
  beats: ReadonlyArray<{ readonly directions?: ReadonlyArray<VoiceDirection> }>,
  direction: VoiceDirection,
): boolean {
  return beats.some((beat) =>
    beat.directions?.some(
      (own) => own.kind === direction.kind && own.text === direction.text,
    ),
  )
}

/**
 * The ONE consumption rule: each token takes the FIRST occurrence in `text` no
 * earlier token — nor the caller's own `isFree` claim — has taken, and the
 * result is the index per token IN INPUT ORDER (`-1` when nothing is left).
 *
 * By POSITION, never by a cursor: the author's inline placement is the intent,
 * and a list ordered differently from the prose is normal input (a plan's
 * `audio[]` in its own order, the repair's scene→first-shot move, which
 * PREPENDS the scene's cues). A cursor walk would skip an earlier token and
 * leak its brackets to the model, so the placer, the renderer and the editor's
 * chip rebuild (`buildPromptDoc`) all match through here and cannot drift.
 * Equal tokens still consume successive occurrences, in order.
 */
export function placeTokens(
  text: string,
  tokens: ReadonlyArray<string>,
  isFree: (start: number, end: number) => boolean = () => true,
): number[] {
  const taken = new Array<boolean>(text.length).fill(false)
  return tokens.map((token) => {
    let at = text.indexOf(token)
    while (
      at !== -1 &&
      (taken.slice(at, at + token.length).some(Boolean) || !isFree(at, at + token.length))
    ) {
      at = text.indexOf(token, at + 1)
    }
    if (at !== -1) for (let i = at; i < at + token.length; i++) taken[i] = true
    return at
  })
}

/** The neutral tokens `text` does NOT carry — placed by {@link placeTokens},
 *  exactly as `renderDirectionsIntoPrompt` will, so the two agree. */
export function unplacedDirectionTokens(
  text: string,
  directions: ReadonlyArray<VoiceDirection>,
): string[] {
  const tokens = directions.map(neutralDirectionText)
  return placeTokens(text, tokens).flatMap((at, i) => (at === -1 ? [tokens[i]] : []))
}

/** `text` with every unplaced token appended at the end (D6) — the importer's
 *  placement, and the fold's safety net. Complete prose comes back untouched. */
export function withDirectionTokens(
  text: string,
  directions: ReadonlyArray<VoiceDirection>,
): string {
  const missing = unplacedDirectionTokens(text, directions)
  if (missing.length === 0) return text
  const base = text.trimEnd()
  return base ? `${base} ${missing.join(" ")}` : missing.join(" ")
}

export interface RenderedDirections {
  /** The prompt with every neutral `[text]` replaced by model syntax (or removed). */
  readonly prompt: string
  /** Directions the model can't honor — removed from the prompt; caller warns. */
  readonly dropped: ReadonlyArray<VoiceDirection>
}

/** Collapse doubled spaces / space-before-punctuation left by a removed token. */
function tidyWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim()
}

/**
 * Translate a prompt's direction chips for the ACTIVE model: each direction's
 * own neutral `[text]` token ({@link placeTokens} — duplicates resolve in
 * order) is replaced with {@link renderVoiceDirection}'s output, or removed
 * (and reported in `dropped`) when the model can't honor it. The directions
 * array comes from the SAME editor doc as the plain text, so every direction
 * has its token; a direction the placer leaves unplaced is simply skipped —
 * exactly the ones {@link unplacedDirectionTokens} reports.
 */
export function renderDirectionsIntoPrompt(
  plainText: string,
  directions: ReadonlyArray<VoiceDirection>,
  provider: string | undefined,
): RenderedDirections {
  const tokens = directions.map(neutralDirectionText)
  const placed = placeTokens(plainText, tokens)
  const dropped: VoiceDirection[] = []
  // Render in DIRECTIONS order (so `dropped` reads in the author's list
  // order), then rewrite by POSITION — a replacement can never shift the
  // index of another direction's token that way.
  const edits: Array<{ at: number; end: number; replacement: string }> = []
  directions.forEach((direction, i) => {
    const at = placed[i]
    if (at === -1) return
    const rendered = renderVoiceDirection(direction, provider)
    if (rendered === null) dropped.push(direction)
    edits.push({ at, end: at + tokens[i].length, replacement: rendered ?? "" })
  })
  edits.sort((a, b) => a.at - b.at)
  let prompt = ""
  let pos = 0
  for (const edit of edits) {
    prompt += plainText.slice(pos, edit.at) + edit.replacement
    pos = edit.end
  }
  prompt += plainText.slice(pos)
  const changed = edits.length > 0
  // No token touched ⇒ the prompt goes out EXACTLY as authored (whitespace
  // included) — tidying is cleanup for the seams replacements/removals leave,
  // never an unconditional rewrite of the user's text.
  return changed ? { prompt: tidyWhitespace(prompt), dropped } : { prompt: plainText, dropped }
}

/**
 * Remove every direction's neutral `[text]` token from the text — the
 * Directing→Framing mirror (linked storyboard prompts): an IMAGE prompt must
 * not carry audio cues, in ANY syntax. Implemented as a render against no
 * provider (silent ⇒ every found token drops), so the two paths can't drift.
 */
export function stripDirectionTokens(
  text: string,
  directions: ReadonlyArray<VoiceDirection>,
): string {
  return renderDirectionsIntoPrompt(text, directions, undefined).prompt
}
