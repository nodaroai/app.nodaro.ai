/**
 * Suno Separate — the public contract of the separation node and its API.
 *
 * The three separation modes, the stem names "one instrument" mode accepts,
 * the result fields a run writes, the credit id each mode is priced from, and
 * the rule that turns a run's output into the URL behind each handle. One
 * module so the route, the worker, both engines' output extractors and the
 * editor read the same answers (they used to keep their own copies and price
 * or route a mode in one place but not another). Structural vocabulary only.
 */

/** Separation modes, in the provider's wire spelling. */
export const SUNO_SEPARATE_TYPES = ["separate_vocal", "split_stem", "split_stem_advanced"] as const
export type SunoSeparateType = (typeof SUNO_SEPARATE_TYPES)[number]

/**
 * Every `stem_name` the provider accepts for `split_stem_advanced` ("one
 * instrument"), verbatim and in the provider's order.
 */
export const SUNO_STEM_NAMES = [
  "Lead Vocal",
  "Drum Kit",
  "Kick",
  "Snare",
  "Risers",
  "Bass",
  "Backing Vocals",
  "Piano",
  "Electric Guitar",
  "Percussion",
  "String Section",
  "Synth",
  "Acoustic Guitar",
  "Sound Effects",
  "Synth Pad",
  "Synth Bass",
  "Guitar",
  "Brass Section",
  "Organ",
  "Electronic Drum Kit",
  "Lead Electric Guitar",
  "Synth Keys",
  "Rhythm Electric Guitar",
  "Electric Piano",
  "Upright Bass",
  "Keyboards",
  "Distorted Electric Guitar",
  "Synth Strings",
  "Synth Lead",
  "Woodwinds",
  "Rhythm Acoustic Guitar",
  "Flute",
  "Harp",
  "Tambourine",
  "Trumpet",
  "Arpeggiator",
  "Accordion",
  "Fiddle",
  "Pedal Steel Guitar",
  "Synth Voice",
  "Violin",
  "Digital Piano",
  "Synth Brass",
  "Mandolin",
  "Choir",
  "Banjo",
  "Bells",
  "Clarinet",
  "Tenor Saxophone",
  "Trombone",
  "Shaker",
  "French Horn",
  "Glockenspiel",
  "Electric Bass",
  "Cello",
  "Timpani",
  "Harmonica",
  "Marimba",
  "Vibraphone",
  "Lap Steel Guitar",
  "Saxophone",
  "Orchestra",
  "Horns",
  "Cymbals",
  "Hand Clap",
  "Oboe",
  "Celesta",
  "Congas",
  "Drone",
  "Alto Saxophone",
  "Double Bass",
  "Ukulele",
  "Harpsichord",
  "Baritone Saxophone",
  "Xylophone",
  "Tuba",
  "Bass Guitar",
  "Whistle",
  "Lead Guitar",
  "Rhodes",
  "808",
  "Bongos",
  "Bassoon",
  "Cowbell",
  "Viola",
  "Sitar",
  "Steel Drums",
  "Piccolo",
  "Theremin",
  "Bagpipes",
  "Hi-Hat",
  "Music Box",
  "Melodica",
  "Tabla",
  "Koto",
  "Djembe",
  "Taiko",
  "Didgeridoo",
] as const
export type SunoStemName = (typeof SUNO_STEM_NAMES)[number]

export const DEFAULT_SUNO_STEM_NAME: SunoStemName = "Lead Vocal"

/**
 * Credit id a mode is priced from. Anything that is not a full-stems or
 * one-instrument run prices as the two-stem (vocals + instrumental) split.
 */
export function sunoSeparateCreditId(
  type: unknown,
): "suno-separate" | "suno-separate-stem" | "suno-separate-single" {
  if (type === "split_stem") return "suno-separate-stem"
  if (type === "split_stem_advanced") return "suno-separate-single"
  return "suno-separate"
}

/**
 * Flat per-stem URL fields of a run's output. `otherUrl` carries the Demucs
 * `other` stem of a full-stems fallback run.
 */
export const SUNO_SEPARATE_STEM_FIELDS = [
  "vocalUrl", "instrumentalUrl", "backingVocalsUrl", "drumsUrl",
  "bassUrl", "guitarUrl", "pianoUrl", "keyboardUrl",
  "percussionUrl", "stringsUrl", "synthUrl", "fxUrl",
  "brassUrl", "woodwindsUrl", "otherUrl",
] as const
export type SunoSeparateStemField = (typeof SUNO_SEPARATE_STEM_FIELDS)[number]

/**
 * One-instrument mode's two takes: the named instrument alone (`isolated`) and
 * the song without it (`without`). Take 1 drives the `isolated` / `without`
 * handles; take 2 is kept with the result but is not wireable.
 */
export const SUNO_SEPARATE_TAKE_FIELDS = ["isolatedUrl", "withoutUrl", "isolated2Url", "without2Url"] as const

/** Every URL field a run's output can carry. */
export const SUNO_SEPARATE_RESULT_FIELDS = [...SUNO_SEPARATE_STEM_FIELDS, ...SUNO_SEPARATE_TAKE_FIELDS] as const
export type SunoSeparateResultField = (typeof SUNO_SEPARATE_RESULT_FIELDS)[number]

/** Non-URL fields a run's output records about how it ran. */
export const SUNO_SEPARATE_META_FIELDS = ["separateType", "stemName", "engineUsed", "sunoRefused", "fallbackReason"] as const

/**
 * The Suno ids a run's output carries for its stems: `sunoTaskId`, the
 * separation task, and `sunoStemIds`, each stem's or take's own id by its
 * result field (`{ vocalUrl: "<id>", … }`). Suno Convert to WAV takes a stem
 * by the separation's task id and the stem's id. A run that Demucs or the
 * connected cloud delivered has none, and neither has an output written before
 * the ids were kept.
 */
export const SUNO_SEPARATE_ID_FIELDS = ["sunoTaskId", "sunoStemIds"] as const

/** The result field behind a handle (old spellings included); the primary field for any other handle, or none. */
export function sunoSeparateHandleField(
  output: Readonly<Record<string, unknown>>,
  handle: string | null | undefined,
): SunoSeparateResultField | undefined {
  switch (handle) {
    case "vocals":
    case "vocal":
    case "vocal-out":
      return "vocalUrl"
    case "instrumental":
    case "instrumental-out":
      return "instrumentalUrl"
    case "isolated":
      return "isolatedUrl"
    case "without":
      return "withoutUrl"
    default: {
      const primary = sunoSeparatePrimaryUrl(output)
      return primary === undefined ? undefined : SUNO_SEPARATE_RESULT_FIELDS.find((field) => str(output[field]) === primary)
    }
  }
}

/**
 * The Suno ids of the stem behind one handle — the separation's task id and
 * that stem's own id — or undefined when the output does not carry both (a
 * Demucs or cloud run, an older output, a stem that did not come back).
 */
export function sunoSeparateHandleIds(
  output: Readonly<Record<string, unknown>>,
  handle: string | null | undefined,
): { readonly taskId: string; readonly audioId: string } | undefined {
  const taskId = str(output.sunoTaskId)
  const ids = output.sunoStemIds
  if (!taskId || typeof ids !== "object" || ids === null || Array.isArray(ids)) return undefined
  const field = sunoSeparateHandleField(output, handle)
  const audioId = field ? str((ids as Record<string, unknown>)[field]) : undefined
  return audioId ? { taskId, audioId } : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined
}

// An output written before the per-field URLs existed: only `audioUrl`.
function isLegacyShape(output: Readonly<Record<string, unknown>>): boolean {
  return !SUNO_SEPARATE_RESULT_FIELDS.some((field) => str(output[field]) !== undefined)
}

/**
 * The URL a run's output puts behind one handle. A stem that did not come back
 * is empty — never filled with the main audio; only an output of the legacy
 * shape routes `audioUrl` to `vocals` / `instrumental`. Accepts the old handle
 * spellings (`vocal`, `vocal-out`, `instrumental-out`). Any other handle, or
 * none, gets the primary URL.
 */
export function sunoSeparateHandleUrl(
  output: Readonly<Record<string, unknown>>,
  handle: string | null | undefined,
): string | undefined {
  switch (handle) {
    case "vocals":
    case "vocal":
    case "vocal-out":
      return str(output.vocalUrl) ?? (isLegacyShape(output) ? str(output.audioUrl) : undefined)
    case "instrumental":
    case "instrumental-out":
      return str(output.instrumentalUrl) ?? (isLegacyShape(output) ? str(output.audioUrl) : undefined)
    case "isolated":
      return str(output.isolatedUrl)
    case "without":
      return str(output.withoutUrl)
    default:
      return sunoSeparatePrimaryUrl(output) ?? str(output.audioUrl)
  }
}

/**
 * A run's main URL: vocals, else instrumental, else the isolated instrument,
 * else the first stem that came back.
 */
export function sunoSeparatePrimaryUrl(output: Readonly<Record<string, unknown>>): string | undefined {
  return (
    str(output.vocalUrl) ??
    str(output.instrumentalUrl) ??
    str(output.isolatedUrl) ??
    SUNO_SEPARATE_STEM_FIELDS.map((field) => str(output[field])).find((url) => url !== undefined)
  )
}
