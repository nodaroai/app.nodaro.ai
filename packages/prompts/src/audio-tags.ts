/**
 * Remove inline `[audio tags]` from speech text, for a model that does not
 * perform them (it would read them aloud). Pure, dependency-free: the
 * backend's credit counter (lib/speech-credits.ts), its payload builder and
 * the editor's estimate (frontend/src/lib/speech-estimate.ts) all read it, so
 * the two engines count exactly the same characters.
 *
 * A tag is `[`, one or more characters that are not `]`, then `]` — what
 * `/\[[^\]]+\]/g` matches. That pattern is quadratic on an unclosed run of `[`
 * (every `[` rescans to the end of the text), and the credit counter runs this
 * on raw request text on the API and orchestrator event loops, so the scan is
 * written by hand: one `indexOf` per `[`, and when no `]` is left no later `[`
 * can match either, so the rest of the text is kept in one slice.
 */
function removeBracketTags(text: string): string {
  let out = ""
  let from = 0
  let open = text.indexOf("[")
  while (open !== -1) {
    const close = text.indexOf("]", open + 1)
    if (close === -1) break
    if (close === open + 1) {
      // "[]" is not a tag (needs 1+ characters); the "[" stays and the scan moves on.
      open = text.indexOf("[", open + 1)
      continue
    }
    out += text.slice(from, open)
    from = close + 1
    open = text.indexOf("[", from)
  }
  return out + text.slice(from)
}

export function stripAudioTags(text: string): string {
  return removeBracketTags(text).replace(/\s{2,}/g, " ").trim()
}

/**
 * The platform's `[square]` tags (the editor's and Studio's tag menus) that
 * mean one of an angle-tag model's own tags under another name. A tag written
 * under the model's own name in brackets (`[cackle]`) needs no row here.
 */
const ANGLE_TAG_ALIASES: Readonly<Record<string, string>> = {
  "laughs": "laugh",
  "laughing": "laugh",
  "starts laughing": "laugh",
  "laughs harder": "laughter",
  "gasps": "gasp",
  "clears throat": "throat-clearing",
  "snorts": "snort",
  "crying": "cry",
  "cries": "cry",
  "sobs": "sob",
  "sobbing": "sob",
  "giggles": "giggle",
  "giggling": "giggle",
  "exhale": "exhales",
  "coughs": "cough",
  "coughing": "cough",
  "whisper": "whispers",
  "shouting": "shout",
  "shouts": "shout",
  "pause": "short pause",
  "yawns": "yawn",
  "screams": "scream",
  "screaming": "scream",
  "groans": "groan",
  "growls": "growl",
  "sneezes": "sneeze",
  "whimpers": "whimper",
  "pants": "pant",
  "panting": "pant",
  "hisses": "hiss",
  "grunts": "grunt",
  "moans": "moan",
  "shrieks": "shriek",
  "snickers": "snicker",
  "cheers": "cheer",
  "cackles": "cackle",
  "breathes": "breath",
  "breathing": "breath",
  "heavy breathing": "heavy breath",
}

/** One bracketed run of up to 40 characters with no bracket inside — bounded, so the scan stays linear. */
const SQUARE_TAG = /\[([^[\]]{1,40})\]/g
/** One angle-bracketed word or phrase (letters, spaces, hyphens), as a tone tag is written — never SSML or a comparison in prose. */
const ANGLE_TAG = /<([A-Za-z][A-Za-z -]{0,39})>/g
/**
 * A known HTML / formatting tag, opening or closing, self-closing or not, with
 * or without attributes (bounded, so the scan stays linear): text pasted from
 * a page or an editor. Never a tone tag of any model.
 */
const HTML_TAG = /<\/?(br|p|b|i|strong|em|u|span|div)(?:\s[^<>]{0,200})?\/?>/gi
/** Of those, the ones that break the text: a line break or a paragraph's edge reads as a space. */
const HTML_BREAKS = new Set(["br", "p"])

/**
 * Speech text for a model that writes its tone tags `<in angle brackets>`
 * from a closed list (`tags`, its capability sheet's): each `[square]` tag
 * becomes the model's tag when it names one (under the model's own name or a
 * known alias: `[laughs]` → `<laugh>`, `[pause]` → `<short pause>`), an
 * angle tag the model performs stays (in its own spelling), every other
 * `[square]` tag is taken out — the model would read it aloud — and a word in
 * angle brackets that is not one of its tags keeps the word and loses the
 * brackets ("Press <Enter> to go" → "Press Enter to go"; decided 2026-11-13).
 * A known HTML / formatting tag (`<br>`, `<p>`, `<b>`, `<i>`, `<strong>`,
 * `<em>`, `<u>`, `<span>`, `<div>`, closing or with attributes) is taken out
 * and its text kept, `<br>` and `<p>` / `</p>` becoming a space ("Line
 * one<br>Line <b>two</b>" → "Line one Line two"; decided 2026-11-13).
 * Spaces left around a removed tag close up; line breaks stay. Pure: the
 * worker sends this, and the credit counters on both engines count it.
 */
export function toAngleTags(text: string, tags: readonly string[]): string {
  const known = new Map(tags.map((t) => [t.toLowerCase(), t]))
  const own = (name: string): string | undefined => {
    const key = name.trim().replace(/\s+/g, " ").toLowerCase()
    return known.get(key) ?? (Object.hasOwn(ANGLE_TAG_ALIASES, key) ? known.get(ANGLE_TAG_ALIASES[key]!) : undefined)
  }
  const rewritten = text
    .replace(HTML_TAG, (_m, name: string) => (HTML_BREAKS.has(name.toLowerCase()) ? " " : ""))
    .replace(ANGLE_TAG, (_m, name: string) => {
      const tag = known.get(name.trim().replace(/\s+/g, " ").toLowerCase())
      return tag ? `<${tag}>` : name
    })
    .replace(SQUARE_TAG, (_m, name: string) => {
      const tag = own(name)
      return tag ? `<${tag}>` : ""
    })
  return rewritten.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "").trim()
}

/** The part of a speech model's capability sheet that decides how its tags are sent (`@nodaro/shared` `TtsCapabilities`). */
export interface SpeechTagSheet {
  readonly audioTags: boolean
  readonly tagSyntax?: "angle"
  readonly tags?: readonly string[]
}

/**
 * Speech text as it is SENT to a model with this sheet: tags kept as written
 * on a model that performs `[square]` tags, rewritten on an angle-tag model
 * ({@link toAngleTags}), stripped on a model that performs none
 * ({@link stripAudioTags}). The one rule the worker sends and both engines'
 * credit counters count.
 */
export function speakableText(text: string, sheet: SpeechTagSheet): string {
  if (!sheet.audioTags) return stripAudioTags(text)
  return sheet.tagSyntax === "angle" ? toAngleTags(text, sheet.tags ?? []) : text
}

/** A speech sheet with the model's per-request character cap. */
export interface SpeechSendSheet extends SpeechTagSheet {
  readonly maxChars: number
}

const angleModel = (sheet: SpeechTagSheet): boolean => sheet.audioTags && sheet.tagSyntax === "angle"

/**
 * The text before the model's cap is applied: on an angle-tag model its tags
 * rewritten (`toAngleTags`, which can lengthen it — `[pause]` → `<short
 * pause>`), on any other model the text as given. What a lane that REFUSES
 * over-cap text instead of cutting it (a workflow run, the MCP tool) measures.
 */
export function speechTextBeforeCap(text: string, sheet: SpeechTagSheet): string {
  return angleModel(sheet) ? toAngleTags(text, sheet.tags ?? []) : text
}

/**
 * The text a speech model is SENT, and the characters it is billed for — the
 * one rule every seam reads (the route's credit guard, the worker, the
 * reconcile's recovery, both engines' estimates).
 *
 * On an angle-tag model the tags are rewritten FIRST and the result is then
 * cut to the cap (decided 2026-11-13: a rewrite can lengthen the text, so
 * cutting first could send more than the model takes); a cut that lands
 * inside a tag drops the broken tag. On any other model the text is cut to
 * the cap and then its tags are kept or stripped (stripping only shortens it),
 * exactly as before the angle-tag models existed.
 */
export function sentSpeechText(text: string, sheet: SpeechSendSheet): string {
  if (!angleModel(sheet)) return speakableText(text.slice(0, sheet.maxChars), sheet)
  const rewritten = toAngleTags(text, sheet.tags ?? [])
  if (rewritten.length <= sheet.maxChars) return rewritten
  const cut = rewritten.slice(0, sheet.maxChars)
  // A tag the cut broke (`<short pa`, or a bare `<` at the very end) would be read aloud: drop it.
  // Prose with a `<` (`x < y`) is left as cut.
  const open = cut.lastIndexOf("<")
  return open !== -1 && /^<([A-Za-z][A-Za-z -]*)?$/.test(cut.slice(open)) ? cut.slice(0, open).trimEnd() : cut
}

/**
 * The most a text can grow when its tags are rewritten for an angle-tag model,
 * as a factor of its length: the platform's `[square]` spelling of a tag
 * against the model's own (`[pause]`, 7 characters, becomes `<short pause>`,
 * 13). A price quoted for an unknown text of a known length on such a model
 * multiplies by this, so it never quotes below the run.
 */
export function angleTagGrowth(tags: readonly string[]): number {
  const known = new Set(tags.map((t) => t.toLowerCase()))
  let growth = 1
  for (const [alias, tag] of Object.entries(ANGLE_TAG_ALIASES)) {
    if (known.has(tag)) growth = Math.max(growth, (tag.length + 2) / (alias.length + 2))
  }
  return growth
}

/** The texts of a dialogue script's lines (`{ text }` entries; anything else counts as no text). */
function lineTexts(lines: unknown): string[] {
  if (!Array.isArray(lines)) return []
  return lines.map((l) => (l && typeof (l as { text?: unknown }).text === "string" ? (l as { text: string }).text : ""))
}

/**
 * The lines of a dialogue script as they are SENT: each line as
 * `sentSpeechText` sends it (on an angle-tag model its tags rewritten, then
 * cut), within what is left of the model's TOTAL cap after the lines before
 * it — so the script as a whole never passes the cap. The script is cut once:
 * the line the cap falls in is cut (a cut inside a tag drops the broken tag)
 * and every line after it is sent as "". The one rule the
 * worker sends and every seam reserves, quotes and bills (`sentDialogueChars`).
 * On a model that sends its tags as written (ElevenLabs dialogue) it only cuts
 * at the cap, so its count is the sum of the lines' texts, at most the cap.
 */
export function sentDialogueLines(lines: unknown, sheet: SpeechSendSheet): string[] {
  let left = sheet.maxChars
  return lineTexts(lines).map((text) => {
    if (left <= 0) return ""
    // The line as the model takes it with no cap at all, so a line longer than the cap on its own counts as cut too.
    const whole = sentSpeechText(text, { ...sheet, maxChars: Number.POSITIVE_INFINITY })
    const sent = whole.length <= left ? whole : sentSpeechText(text, { ...sheet, maxChars: left })
    // A cut line ends the script: nothing after it is sent.
    left = sent === whole ? left - sent.length : 0
    return sent
  })
}

/** The characters a dialogue script is billed for: its lines as sent (`sentDialogueLines`), summed. */
export function sentDialogueChars(lines: unknown, sheet: SpeechSendSheet): number {
  return sentDialogueLines(lines, sheet).reduce((sum, text) => sum + text.length, 0)
}

/**
 * The length a lane that REFUSES an over-cap script measures: each line as the
 * model takes it before the cap (`speechTextBeforeCap`), summed.
 */
export function dialogueTextBeforeCap(lines: unknown, sheet: SpeechTagSheet): number {
  return lineTexts(lines).reduce((sum, t) => sum + speechTextBeforeCap(t, sheet).length, 0)
}
