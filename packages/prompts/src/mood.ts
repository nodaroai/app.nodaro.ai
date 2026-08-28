/**
 * Canonical catalog of Mood / emotional-state choices.
 *
 * Single-pick parameter node — user picks ONE mood that describes the
 * subject's emotional state. The promptHint captures the natural
 * consequence on face + body language (a happy mood → "with a warm smile
 * and bright eyes", a fierce mood → "with an intense, fierce expression").
 *
 * Separate from:
 *  - Tone (the overall content/writing tone — sarcastic, playful, formal)
 *  - Atmosphere (what's in the air — fog, rain, dust)
 *  - Style (artistic medium — oil painting, photorealistic)
 *
 * Applies to both image and video consumers (mood describes the subject,
 * not video-specific). Not in STILL_IMAGE_EXCLUDE_TYPES.
 *
 * Includes pre/post free-text fields (same pattern as Person) for
 * specifics the catalog can't express ("restrained grief", "crying with
 * relief", etc.).
 *
 * Shared between the picker UI, the standalone Mood parameter node, and
 * the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

import { resolveTerm, type PickerHintMode } from "./term.js"

export type MoodCategory = "positive" | "negative" | "neutral" | "intense"

export interface Mood {
  readonly id: string
  readonly label: string
  readonly category: MoodCategory
  readonly description: string
  readonly promptHint: string
  /** Compact professional term injected in compact hint mode (see `term.ts`). */
  readonly term?: string
}

export const MOODS: ReadonlyArray<Mood> = [
  // -------------------- Positive --------------------
  { id: "happy",       label: "Happy",        category: "positive", description: "Warm, smiling happiness",     promptHint: "with a warm, happy expression and a genuine smile", term: "happy mood" },
  { id: "joyful",      label: "Joyful",       category: "positive", description: "Radiant, unrestrained joy",   promptHint: "with a radiant, joyful expression full of delight, the corners of the mouth rising uncontrollably, steps light", term: "radiant joyful mood" },
  { id: "relieved",    label: "Relieved",     category: "positive", description: "Tension releasing into calm", promptHint: "with a relieved expression, letting out a long breath, shoulders relaxing completely, a faint long-awaited smile", term: "relieved mood" },
  { id: "serene",      label: "Serene",       category: "positive", description: "Calm, peaceful contentment",  promptHint: "with a serene, peaceful expression and relaxed posture", term: "serene mood" },
  { id: "playful",     label: "Playful",      category: "positive", description: "Mischievous, playful energy", promptHint: "with a playful, mischievous expression and light energy", term: "playful mood" },
  { id: "confident",   label: "Confident",    category: "positive", description: "Self-assured, confident",     promptHint: "with a confident, self-assured expression and poised demeanor", term: "confident, self-assured demeanor" },
  { id: "loving",      label: "Loving",       category: "positive", description: "Tender, affectionate",        promptHint: "with a tender, loving expression", term: "tender, loving mood" },
  { id: "amused",      label: "Amused",       category: "positive", description: "Subtly amused, smirking",     promptHint: "with a subtly amused expression, a faint smirk", term: "faintly amused expression" },
  { id: "smirking",    label: "Smirking",     category: "neutral",  description: "Cocky, arrogant amusement",   promptHint: "with a cocky, arrogant smirk and one eyebrow slightly raised", term: "cocky smirk" },
  { id: "eccentric",   label: "Eccentric",    category: "positive", description: "Quirky, unconventional",      promptHint: "with a quirky, eccentric expression and offbeat playful energy", term: "quirky, eccentric energy" },
  { id: "hopeful",     label: "Hopeful",      category: "positive", description: "Bright-eyed, optimistic",     promptHint: "with a hopeful expression, a soft slight smile and bright, expectant eyes", term: "hopeful mood" },

  // -------------------- Negative --------------------
  { id: "sad",         label: "Sad",          category: "negative", description: "Quietly sad, downcast",       promptHint: "with a quietly sad, downcast expression, head lowered, shoulders trembling slightly, eyes reddening", term: "sad, downcast mood" },
  { id: "angry",       label: "Angry",        category: "negative", description: "Clear anger, tension",        promptHint: "with an angry expression, furrowed brow and tight jaw, fists clenched, chest heaving", term: "angry mood" },
  { id: "afraid",      label: "Afraid",       category: "negative", description: "Frightened, wide-eyed",       promptHint: "with a frightened expression, wide eyes and tense posture", term: "fearful mood" },
  { id: "anxious",     label: "Anxious",      category: "negative", description: "Nervous, worried",            promptHint: "with an anxious, worried expression and restless tension, fingers tapping, eyes darting, breath quickening", term: "anxious, nervous mood" },
  { id: "melancholy",  label: "Melancholy",   category: "negative", description: "Wistful sadness",             promptHint: "with a melancholy, wistful expression lost in thought", term: "melancholic mood" },
  { id: "devastated",  label: "Devastated",   category: "negative", description: "Heartbroken grief",           promptHint: "with a devastated, heartbroken expression", term: "devastated, heartbroken mood" },
  { id: "grieving",    label: "Grieving",     category: "negative", description: "Deep grief, loss",            promptHint: "with a grieving expression of deep loss", term: "grief-stricken mood" },
  { id: "caught-off-guard", label: "Caught Off Guard", category: "negative", description: "Startled mid-reaction", promptHint: "with a startled, caught-off-guard expression, lips slightly parted mid-reaction", term: "caught-off-guard expression" },
  { id: "aloof",       label: "Aloof",        category: "negative", description: "Withdrawn, uninterested",     promptHint: "with an aloof, withdrawn expression and a gaze pointedly elsewhere", term: "aloof, detached mood" },
  { id: "vulnerable",  label: "Vulnerable",   category: "negative", description: "Exposed, defenseless",        promptHint: "with a vulnerable, exposed expression, eyes faintly tearful and shoulders soft", term: "vulnerable, exposed mood" },
  { id: "coy",         label: "Coy",          category: "negative", description: "Shy, downcast",               promptHint: "with a coy, shy expression, downcast eyes, a faint blush and lips lightly pressed", term: "coy, bashful mood" },
  { id: "bored",       label: "Bored",        category: "negative", description: "Disinterested, deadpan",      promptHint: "with a bored, disinterested expression and a slack, deadpan stare", term: "bored, deadpan mood" },
  { id: "embarrassed", label: "Embarrassed",  category: "negative", description: "Blushing, eyes averted",      promptHint: "with an embarrassed expression, flushed red cheeks and eyes averted", term: "embarrassed, flushed expression" },
  { id: "disgusted",   label: "Disgusted",    category: "negative", description: "Repulsed, recoiling",         promptHint: "with a disgusted expression, lip curled and nose wrinkled in distaste", term: "disgusted expression" },
  { id: "bewildered",  label: "Bewildered",   category: "negative", description: "Confused, lost",              promptHint: "with a bewildered, confused expression, brow furrowed and eyes wide", term: "bewildered expression" },

  // -------------------- Neutral / Contemplative --------------------
  { id: "thoughtful",  label: "Thoughtful",   category: "neutral",  description: "Deep in thought",             promptHint: "with a thoughtful, contemplative expression", term: "thoughtful, contemplative mood" },
  { id: "stoic",       label: "Stoic",        category: "neutral",  description: "Impassive, unreadable",       promptHint: "with a stoic, impassive expression revealing nothing", term: "stoic, impassive mood" },
  { id: "calm",        label: "Calm",         category: "neutral",  description: "Centered, unreactive",        promptHint: "with a calm, centered expression", term: "calm mood" },
  { id: "curious",     label: "Curious",      category: "neutral",  description: "Intrigued, alert",            promptHint: "with a curious, intrigued expression and alert eyes", term: "curious mood" },
  { id: "mysterious",  label: "Mysterious",   category: "neutral",  description: "Inscrutable, enigmatic",      promptHint: "with a mysterious, enigmatic expression hard to read", term: "mysterious, enigmatic mood" },
  { id: "dazed",       label: "Dazed",        category: "neutral",  description: "Dreamy, half-present",        promptHint: "with a dazed, dreamy expression, eyes slightly out of focus and only half-present", term: "dazed, dreamy mood" },
  { id: "sleepy",      label: "Sleepy",       category: "neutral",  description: "Drowsy, heavy-lidded",        promptHint: "with a sleepy, drowsy expression, heavy eyelids and a slow, soft blink", term: "sleepy mood" },
  { id: "unbothered",  label: "Unbothered",   category: "neutral",  description: "Calm self-possession",        promptHint: "with an unbothered, self-possessed expression and a confident, detached calm", term: "unbothered, self-possessed calm" },

  // -------------------- Intense / Dramatic --------------------
  { id: "fierce",      label: "Fierce",       category: "intense",  description: "Fierce, commanding",          promptHint: "with a fierce, commanding expression and blazing intensity", term: "fierce, commanding intensity" },
  { id: "determined",  label: "Determined",   category: "intense",  description: "Resolute, focused will",      promptHint: "with a determined, resolute expression and iron focus", term: "determined, resolute mood" },
  { id: "passionate",  label: "Passionate",   category: "intense",  description: "Burning passion",             promptHint: "with a passionate, burning expression full of conviction", term: "passionate mood" },
  { id: "brooding",    label: "Brooding",     category: "intense",  description: "Dark, brooding melancholy",   promptHint: "with a brooding, dark expression and moody introspection", term: "brooding mood" },
  { id: "seductive",   label: "Seductive",    category: "intense",  description: "Alluring, seductive",         promptHint: "with a seductive, alluring expression and lidded gaze", term: "seductive mood" },
  { id: "defiant",     label: "Defiant",      category: "intense",  description: "Defiant, unyielding",         promptHint: "with a defiant, unyielding expression and challenging stance", term: "defiant mood" },
  { id: "sultry",      label: "Sultry",       category: "intense",  description: "Smoldering, heavy-lidded",    promptHint: "with a sultry, smoldering expression, heavy-lidded gaze and lips softly parted", term: "sultry mood" },
  { id: "smoldering",  label: "Smoldering",   category: "intense",  description: "Coiled, slow-burning intensity", promptHint: "with a smoldering, coiled expression, slow-burning intensity behind half-closed eyes and a still, predatory calm", term: "smoldering intensity" },
  { id: "sinister",    label: "Sinister",     category: "intense",  description: "Dark, malicious, threatening", promptHint: "with a sinister expression, a slow crooked smile and eyes glinting with dark malicious intent", term: "sinister mood" },
  { id: "wiccan-mystical", label: "Wiccan / Mystical", category: "intense", description: "Quietly otherworldly, occult", promptHint: "with a quietly mystical, otherworldly expression, eyes distant and knowing as if reading something the camera cannot see", term: "occult, otherworldly mystical mood" },
  { id: "lazy-shy",    label: "Lazy Shy",     category: "neutral",  description: "Drowsy, soft, half-shy",      promptHint: "with a soft, drowsy half-shy expression, eyes lowered and barely-there smile, languid and unbothered", term: "drowsy, half-shy mood" },
  { id: "awe",         label: "Awe",          category: "intense",  description: "Wonder, reverent",            promptHint: "with an awestruck expression of wonder, mouth slightly agape and wide-eyed", term: "awestruck wonder" },
  { id: "shocked",     label: "Shocked",      category: "intense",  description: "Surprised, mouth open",       promptHint: "with a shocked, surprised expression, eyes wide, brows raised and mouth open", term: "shocked expression" },

  // -------------------- Micro-emotions --------------------
  { id: "flirty",      label: "Flirty",       category: "positive", description: "Playful flirtation, lingering smile, sustained eye contact", promptHint: "with a flirty expression, a lingering playful smile and sustained, knowing eye contact with the camera", term: "flirty mood" },
  { id: "suspicious",  label: "Suspicious",   category: "negative", description: "Wary distrust, narrowed eyes, side-eye", promptHint: "with a suspicious, wary expression, eyes narrowed in distrust and a sidelong side-eye glance", term: "suspicious, wary mood" },
  { id: "resigned",    label: "Resigned",     category: "neutral",  description: "Quiet acceptance of an unpleasant situation, sigh", promptHint: "with a resigned expression of quiet acceptance, shoulders softly dropped mid-sigh and a tired half-closed gaze", term: "resigned mood of quiet acceptance" },
  { id: "conflicted",  label: "Conflicted",   category: "neutral",  description: "Visible internal struggle, brow furrowed, gaze unfocused", promptHint: "with a conflicted expression of visible internal struggle, brow furrowed and gaze unfocused, caught between two impulses", term: "conflicted, torn mood" },
] as const

const moodById = new Map<string, Mood>(MOODS.map((m) => [m.id, m]))

export function getMood(id: string | undefined | null): Mood | undefined {
  if (!id) return undefined
  return moodById.get(id)
}

export function getMoodLabel(id: string | undefined | null, fallback?: string): string {
  const m = getMood(id)
  if (m) return m.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getMoodPromptHint(id: string | undefined | null): string {
  return getMood(id)?.promptHint ?? ""
}

/**
 * The COMPACT counterpart of `getMoodPromptHint`: the short professional term
 * ("melancholic mood", "cocky smirk") a consumer injects instead of the full
 * expression clause. Same lookup, same empty-string-on-miss behavior.
 */
export function getMoodTerm(id: string | undefined | null): string {
  return resolveTerm(getMood(id))
}

export const MOOD_IDS: ReadonlyArray<string> = MOODS.map((m) => m.id)

export const MOOD_CATEGORY_LABELS: Readonly<Record<MoodCategory, string>> = {
  positive: "Positive",
  negative: "Negative",
  neutral: "Neutral",
  intense: "Intense",
}

export const MOOD_CATEGORY_ORDER: ReadonlyArray<MoodCategory> = [
  "positive",
  "negative",
  "neutral",
  "intense",
]

/**
 * Shape of Mood parameter data. Single id OR array of up to 2 ids (mixed
 * mood like "smirking + aloof"). Plus optional pre/post free text.
 */
export interface MoodValue {
  mood?: string | ReadonlyArray<string>
  preText?: string
  postText?: string
}

/**
 * Combine 1-2 mood ids into a single expression clause. Single → the entry's
 * own promptHint. Two → strip the leading "with a ... expression" template
 * from each and weave them: "with a smirking and aloof expression".
 */
function buildMoodHint(value: unknown): string {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  if (ids.length === 0) return ""
  if (ids.length === 1) return getMoodPromptHint(ids[0])
  const labels = ids
    .slice(0, 2)
    .map((id) => getMood(id)?.label?.toLowerCase() ?? "")
    .filter((s): s is string => Boolean(s))
  if (labels.length < 2) return getMoodPromptHint(ids[0])
  return `with a ${labels[0]} and ${labels[1]} expression`
}

/**
 * Combine 1-2 mood ids into a single COMPACT clause: the entry's short
 * professional term, or the two terms joined with " and " for a mixed mood
 * ("cocky smirk and aloof, detached mood"). The full-mode weave rebuilds the
 * "with a ... expression" template from labels; a term already carries its own
 * grammar, so compact just joins.
 */
function buildMoodTerm(value: unknown): string {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  const terms = ids
    .slice(0, 2)
    .map((id) => getMoodTerm(id))
    .filter((t) => t.length > 0)
  return terms.join(" and ")
}

/**
 * Build prompt hints from MoodData: optional pre-text, the selected mood's
 * hint (single or mixed), optional post-text. Returns array — caller joins
 * with ", ".
 *
 * @param mode `"compact"` swaps the mood fragment for its short professional
 *   term (delegates to `buildMoodTerms`); pre/post free text is unaffected.
 */
export function buildMoodHints(
  data: Record<string, unknown> & MoodValue,
  mode: PickerHintMode = "full",
): string[] {
  if (mode === "compact") return buildMoodTerms(data)

  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  const moodHint = buildMoodHint(data.mood)
  if (moodHint) hints.push(moodHint)

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}

/**
 * Compact counterpart of `buildMoodHints`: the same pre-text → mood →
 * post-text order, emitting the mood's short professional term ("melancholic
 * mood", "cocky smirk") instead of the full expression clause. Free-text
 * pre/post fields are user prose and pass through unchanged in both modes.
 */
export function buildMoodTerms(
  data: Record<string, unknown> & MoodValue,
): string[] {
  const terms: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) terms.push(pre)

  const moodTerm = buildMoodTerm(data.mood)
  if (moodTerm) terms.push(moodTerm)

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) terms.push(post)

  return terms
}
