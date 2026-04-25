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

export type MoodCategory = "positive" | "negative" | "neutral" | "intense"

export interface Mood {
  readonly id: string
  readonly label: string
  readonly category: MoodCategory
  readonly description: string
  readonly promptHint: string
}

export const MOODS: ReadonlyArray<Mood> = [
  // -------------------- Positive --------------------
  { id: "happy",       label: "Happy",        category: "positive", description: "Warm, smiling happiness",     promptHint: "with a warm, happy expression and a genuine smile" },
  { id: "joyful",      label: "Joyful",       category: "positive", description: "Radiant, unrestrained joy",   promptHint: "with a radiant, joyful expression full of delight" },
  { id: "serene",      label: "Serene",       category: "positive", description: "Calm, peaceful contentment",  promptHint: "with a serene, peaceful expression and relaxed posture" },
  { id: "playful",     label: "Playful",      category: "positive", description: "Mischievous, playful energy", promptHint: "with a playful, mischievous expression and light energy" },
  { id: "confident",   label: "Confident",    category: "positive", description: "Self-assured, confident",     promptHint: "with a confident, self-assured expression and poised demeanor" },
  { id: "loving",      label: "Loving",       category: "positive", description: "Tender, affectionate",        promptHint: "with a tender, loving expression" },
  { id: "amused",      label: "Amused",       category: "positive", description: "Subtly amused, smirking",     promptHint: "with a subtly amused expression, a faint smirk" },
  { id: "smirking",    label: "Smirking",     category: "positive", description: "Cocky, arrogant amusement",   promptHint: "with a cocky, arrogant smirk and one eyebrow slightly raised" },
  { id: "eccentric",   label: "Eccentric",    category: "positive", description: "Quirky, unconventional",      promptHint: "with a quirky, eccentric expression and offbeat playful energy" },
  { id: "hopeful",     label: "Hopeful",      category: "positive", description: "Bright-eyed, optimistic",     promptHint: "with a hopeful expression, a soft slight smile and bright, expectant eyes" },

  // -------------------- Negative --------------------
  { id: "sad",         label: "Sad",          category: "negative", description: "Quietly sad, downcast",       promptHint: "with a quietly sad, downcast expression" },
  { id: "angry",       label: "Angry",        category: "negative", description: "Clear anger, tension",        promptHint: "with an angry expression, furrowed brow and tight jaw" },
  { id: "afraid",      label: "Afraid",       category: "negative", description: "Frightened, wide-eyed",       promptHint: "with a frightened expression, wide eyes and tense posture" },
  { id: "anxious",     label: "Anxious",      category: "negative", description: "Nervous, worried",            promptHint: "with an anxious, worried expression and restless tension" },
  { id: "melancholy",  label: "Melancholy",   category: "negative", description: "Wistful sadness",             promptHint: "with a melancholy, wistful expression lost in thought" },
  { id: "devastated",  label: "Devastated",   category: "negative", description: "Heartbroken grief",           promptHint: "with a devastated, heartbroken expression" },
  { id: "grieving",    label: "Grieving",     category: "negative", description: "Deep grief, loss",            promptHint: "with a grieving expression of deep loss" },
  { id: "caught-off-guard", label: "Caught Off Guard", category: "negative", description: "Startled mid-reaction", promptHint: "with a startled, caught-off-guard expression, lips slightly parted mid-reaction" },
  { id: "aloof",       label: "Aloof",        category: "negative", description: "Withdrawn, uninterested",     promptHint: "with an aloof, withdrawn expression and a gaze pointedly elsewhere" },
  { id: "vulnerable",  label: "Vulnerable",   category: "negative", description: "Exposed, defenseless",        promptHint: "with a vulnerable, exposed expression, eyes faintly tearful and shoulders soft" },
  { id: "coy",         label: "Coy",          category: "negative", description: "Shy, downcast",               promptHint: "with a coy, shy expression, downcast eyes, a faint blush and lips lightly pressed" },
  { id: "bored",       label: "Bored",        category: "negative", description: "Disinterested, deadpan",      promptHint: "with a bored, disinterested expression and a slack, deadpan stare" },
  { id: "embarrassed", label: "Embarrassed",  category: "negative", description: "Blushing, eyes averted",      promptHint: "with an embarrassed expression, flushed red cheeks and eyes averted" },
  { id: "disgusted",   label: "Disgusted",    category: "negative", description: "Repulsed, recoiling",         promptHint: "with a disgusted expression, lip curled and nose wrinkled in distaste" },
  { id: "bewildered",  label: "Bewildered",   category: "negative", description: "Confused, lost",              promptHint: "with a bewildered, confused expression, brow furrowed and eyes wide" },

  // -------------------- Neutral / Contemplative --------------------
  { id: "thoughtful",  label: "Thoughtful",   category: "neutral",  description: "Deep in thought",             promptHint: "with a thoughtful, contemplative expression" },
  { id: "stoic",       label: "Stoic",        category: "neutral",  description: "Impassive, unreadable",       promptHint: "with a stoic, impassive expression revealing nothing" },
  { id: "calm",        label: "Calm",         category: "neutral",  description: "Centered, unreactive",        promptHint: "with a calm, centered expression" },
  { id: "curious",     label: "Curious",      category: "neutral",  description: "Intrigued, alert",            promptHint: "with a curious, intrigued expression and alert eyes" },
  { id: "mysterious",  label: "Mysterious",   category: "neutral",  description: "Inscrutable, enigmatic",      promptHint: "with a mysterious, enigmatic expression hard to read" },
  { id: "dazed",       label: "Dazed",        category: "neutral",  description: "Dreamy, half-present",        promptHint: "with a dazed, dreamy expression, eyes slightly out of focus and only half-present" },
  { id: "sleepy",      label: "Sleepy",       category: "neutral",  description: "Drowsy, heavy-lidded",        promptHint: "with a sleepy, drowsy expression, heavy eyelids and a slow, soft blink" },
  { id: "unbothered",  label: "Unbothered",   category: "neutral",  description: "Calm self-possession",        promptHint: "with an unbothered, self-possessed expression and a confident, detached calm" },

  // -------------------- Intense / Dramatic --------------------
  { id: "fierce",      label: "Fierce",       category: "intense",  description: "Fierce, commanding",          promptHint: "with a fierce, commanding expression and blazing intensity" },
  { id: "determined",  label: "Determined",   category: "intense",  description: "Resolute, focused will",      promptHint: "with a determined, resolute expression and iron focus" },
  { id: "passionate",  label: "Passionate",   category: "intense",  description: "Burning passion",             promptHint: "with a passionate, burning expression full of conviction" },
  { id: "brooding",    label: "Brooding",     category: "intense",  description: "Dark, brooding melancholy",   promptHint: "with a brooding, dark expression and moody introspection" },
  { id: "seductive",   label: "Seductive",    category: "intense",  description: "Alluring, seductive",         promptHint: "with a seductive, alluring expression and lidded gaze" },
  { id: "defiant",     label: "Defiant",      category: "intense",  description: "Defiant, unyielding",         promptHint: "with a defiant, unyielding expression and challenging stance" },
  { id: "sultry",      label: "Sultry",       category: "intense",  description: "Smoldering, heavy-lidded",    promptHint: "with a sultry, smoldering expression, heavy-lidded gaze and lips softly parted" },
  { id: "smoldering",  label: "Smoldering",   category: "intense",  description: "Coiled, slow-burning intensity", promptHint: "with a smoldering, coiled expression, slow-burning intensity behind half-closed eyes and a still, predatory calm" },
  { id: "sinister",    label: "Sinister",     category: "intense",  description: "Dark, malicious, threatening", promptHint: "with a sinister expression, a slow crooked smile and eyes glinting with dark malicious intent" },
  { id: "wiccan-mystical", label: "Wiccan / Mystical", category: "intense", description: "Quietly otherworldly, occult", promptHint: "with a quietly mystical, otherworldly expression, eyes distant and knowing as if reading something the camera cannot see" },
  { id: "lazy-shy",    label: "Lazy Shy",     category: "positive", description: "Drowsy, soft, half-shy",      promptHint: "with a soft, drowsy half-shy expression, eyes lowered and barely-there smile, languid and unbothered" },
  { id: "awe",         label: "Awe",          category: "intense",  description: "Wonder, reverent",            promptHint: "with an awestruck expression of wonder, mouth slightly agape and wide-eyed" },
  { id: "shocked",     label: "Shocked",      category: "intense",  description: "Surprised, mouth open",       promptHint: "with a shocked, surprised expression, eyes wide, brows raised and mouth open" },
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
 * Shape of Mood parameter data. Single-pick + optional pre/post free text.
 */
export interface MoodValue {
  mood?: string
  preText?: string
  postText?: string
}

/**
 * Build prompt hints from MoodData: optional pre-text, the selected mood's
 * hint, optional post-text. Returns array — caller joins with ", ".
 */
export function buildMoodHints(
  data: Record<string, unknown> & MoodValue,
): string[] {
  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  const moodId = typeof data.mood === "string" ? data.mood : ""
  const moodHint = getMoodPromptHint(moodId)
  if (moodHint) hints.push(moodHint)

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}
