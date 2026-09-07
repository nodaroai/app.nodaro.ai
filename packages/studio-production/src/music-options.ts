/**
 * App-owned MUSIC option catalogs for the Soundtrack (Suno) pickers.
 *
 * Nodaro/Suno expose NO catalogs for genre / mood / instruments / vocal style /
 * language — those are free-text on `/v1/suno/generate` (only `instrumental` and
 * `vocalGender` are typed flags). So these lists are OURS (curated), and
 * {@link composeMusicStyle} maps the selections into the Suno request: descriptive
 * tags fold into the `prompt`, and the vocals toggle / gender drive the dedicated
 * `instrumental` + `vocalGender` flags (see `useMusic`).
 *
 * TODO(nodaro): if the platform ever ships music catalogs, swap these for the
 * shared ones (one import change) — keep this the single source meanwhile.
 */

export interface MusicOption {
  readonly id: string
  readonly label: string
}

export const MUSIC_GENRES: ReadonlyArray<MusicOption> = [
  { id: "cinematic", label: "Cinematic" },
  { id: "orchestral", label: "Orchestral" },
  { id: "epic-trailer", label: "Epic trailer" },
  { id: "electronic", label: "Electronic" },
  { id: "synthwave", label: "Synthwave" },
  { id: "ambient", label: "Ambient" },
  { id: "lo-fi", label: "Lo-fi" },
  { id: "rock", label: "Rock" },
  { id: "metal", label: "Metal" },
  { id: "pop", label: "Pop" },
  { id: "hip-hop", label: "Hip-hop" },
  { id: "rnb", label: "R&B / Soul" },
  { id: "jazz", label: "Jazz" },
  { id: "classical", label: "Classical" },
  { id: "folk", label: "Folk / Acoustic" },
  { id: "country", label: "Country" },
  { id: "reggae", label: "Reggae" },
  { id: "corporate", label: "Corporate / Upbeat" },
  { id: "world", label: "World" },
]

export const MUSIC_MOODS: ReadonlyArray<MusicOption> = [
  { id: "epic", label: "Epic" },
  { id: "tense", label: "Tense" },
  { id: "uplifting", label: "Uplifting" },
  { id: "melancholic", label: "Melancholic" },
  { id: "dark", label: "Dark" },
  { id: "dreamy", label: "Dreamy" },
  { id: "energetic", label: "Energetic" },
  { id: "calm", label: "Calm / Peaceful" },
  { id: "romantic", label: "Romantic" },
  { id: "playful", label: "Playful" },
  { id: "mysterious", label: "Mysterious" },
  { id: "triumphant", label: "Triumphant" },
  { id: "nostalgic", label: "Nostalgic" },
  { id: "aggressive", label: "Aggressive" },
  { id: "hopeful", label: "Hopeful" },
]

export const MUSIC_INSTRUMENTS: ReadonlyArray<MusicOption> = [
  { id: "strings", label: "Strings" },
  { id: "piano", label: "Piano" },
  { id: "drums", label: "Drums" },
  { id: "synth", label: "Synth" },
  { id: "electric-guitar", label: "Electric guitar" },
  { id: "acoustic-guitar", label: "Acoustic guitar" },
  { id: "bass", label: "Bass" },
  { id: "brass", label: "Brass" },
  { id: "choir", label: "Choir" },
  { id: "percussion", label: "Percussion" },
  { id: "saxophone", label: "Saxophone" },
  { id: "violin", label: "Violin" },
  { id: "cello", label: "Cello" },
  { id: "flute", label: "Flute" },
  { id: "organ", label: "Organ" },
  { id: "808", label: "808 / Trap" },
]

export const MUSIC_SINGING_STYLES: ReadonlyArray<MusicOption> = [
  { id: "powerful", label: "Powerful" },
  { id: "soft", label: "Soft / Gentle" },
  { id: "rap", label: "Rap" },
  { id: "choir", label: "Choir" },
  { id: "whisper", label: "Whisper" },
  { id: "operatic", label: "Operatic" },
  { id: "raspy", label: "Raspy" },
  { id: "falsetto", label: "Falsetto" },
  { id: "spoken", label: "Spoken word" },
  { id: "harmonies", label: "Harmonies" },
]

export const MUSIC_LANGUAGES: ReadonlyArray<MusicOption> = [
  { id: "english", label: "English" },
  { id: "spanish", label: "Spanish" },
  { id: "hebrew", label: "Hebrew" },
  { id: "french", label: "French" },
  { id: "german", label: "German" },
  { id: "portuguese", label: "Portuguese" },
  { id: "italian", label: "Italian" },
  { id: "japanese", label: "Japanese" },
  { id: "korean", label: "Korean" },
  { id: "hindi", label: "Hindi" },
  { id: "arabic", label: "Arabic" },
  { id: "mandarin", label: "Mandarin" },
]

/** Whether the track has singing. */
export type Vocals = "instrumental" | "vocals"
/** Suno's `vocalGender` flag (+ "any" = let the model choose / omit the flag). */
export type VocalGender = "any" | "male" | "female"

/**
 * Every member of a string union, exactly once, in declaration order.
 *
 * `ReadonlyArray<Vocals>` alone guards ONE direction: it refuses a value the
 * union doesn't have, and says nothing about a member the union GAINS — which
 * would then be silently unpublished (no registry row, no legend line, and
 * repair dropping a value the app itself can produce). `Record<T, true>` fails
 * `tsc` on a missing member and on a stale one, so both directions are pinned
 * the way `CAST_KIND_LIST`'s own guard test pins the cast kinds.
 */
function allOf<T extends string>(members: Record<T, true>): ReadonlyArray<T> {
  return Object.keys(members) as unknown as ReadonlyArray<T>
}

/** The fixed `vocals` vocabulary, as the app actually offers it (the toggle in
 *  `SoundPanel`, the registry's `music.vocals` row, and `music.vocals` document
 *  field repair — one list, pinned BOTH ways against {@link Vocals}). */
export const MUSIC_VOCALS: ReadonlyArray<Vocals> = allOf<Vocals>({
  instrumental: true,
  vocals: true,
})
/** The fixed `vocalGender` vocabulary — same discipline as {@link MUSIC_VOCALS}. */
export const MUSIC_VOCAL_GENDERS: ReadonlyArray<VocalGender> = allOf<VocalGender>({
  any: true,
  male: true,
  female: true,
})

/** The Suno track length cap (`useMusic`, the registry's `music.maxDuration`,
 *  the legend, and the strict/structural `music.duration` bounds) — the
 *  format's own duration ceiling for a soundtrack rather than a per-catalog
 *  value, since Suno's catalogs carry no duration lever of their own. Hoisted
 *  here (plan-import-v2 D5) because this module is the one BROWSER-FREE home
 *  every one of those readers can import — a hook cannot enter the registry's
 *  closure, and the registry cannot enter a hook's. */
export const MUSIC_MAX_DURATION_SECONDS = 30

/** The full set of Soundtrack picker selections. */
export interface MusicSelections {
  readonly vocals: Vocals
  readonly vocalGender: VocalGender
  readonly genre?: string
  readonly mood?: string
  readonly instruments: ReadonlyArray<string>
  readonly singingStyle?: string
  readonly language?: string
}

export const DEFAULT_MUSIC_SELECTIONS: MusicSelections = {
  vocals: "instrumental",
  vocalGender: "any",
  instruments: [],
}

/**
 * Do these selections carry a PICK — a decision the user (or a landed plan)
 * actually made — or are they still the {@link DEFAULT_MUSIC_SELECTIONS} the
 * panel opens on? The soundtrack draft's per-field merge needs the distinction
 * (`lib/music-plan`: an untouched picker set takes an arriving plan's), and the
 * export side already spells the same rule for its own half — `musicPickers`
 * (`production-format/export.ts`) omits `vocals`/`vocalGender` while they still
 * read as the defaults, because a default is not a decision. Keep the two in
 * step; this one is the single name for the whole set.
 *
 * BY VALUE, never by key presence: clearing a picker back to "Any" writes
 * `{ genre: undefined }`, which still HAS the key.
 */
export function hasMusicPicks(sel: MusicSelections | undefined): boolean {
  if (!sel) return false
  return (
    sel.vocals !== DEFAULT_MUSIC_SELECTIONS.vocals ||
    sel.vocalGender !== DEFAULT_MUSIC_SELECTIONS.vocalGender ||
    sel.instruments.length > 0 ||
    !!sel.genre ||
    !!sel.mood ||
    !!sel.singingStyle ||
    !!sel.language
  )
}

function labelOf(
  opts: ReadonlyArray<MusicOption>,
  id: string | undefined,
): string | undefined {
  return id ? opts.find((o) => o.id === id)?.label : undefined
}

/**
 * Compose the picker selections into descriptive style tags (lower-cased,
 * comma-joinable) that `useMusic` folds into the Suno `prompt`. The vocals toggle
 * + gender are handled separately as the `instrumental` / `vocalGender` flags, so
 * they're NOT in these tags — except the instrumental/with-vocals + singing style
 * + language descriptors, which help Suno's text-to-music. Pure; order: mood →
 * genre → instruments → (vocals descriptors).
 */
export function composeMusicStyle(sel: MusicSelections): string[] {
  const tags: string[] = []
  const mood = labelOf(MUSIC_MOODS, sel.mood)
  if (mood) tags.push(mood.toLowerCase())
  const genre = labelOf(MUSIC_GENRES, sel.genre)
  if (genre) tags.push(genre.toLowerCase())
  for (const inst of sel.instruments) {
    const l = labelOf(MUSIC_INSTRUMENTS, inst)
    if (l) tags.push(l.toLowerCase())
  }
  if (sel.vocals === "instrumental") {
    tags.push("instrumental")
  } else {
    const style = labelOf(MUSIC_SINGING_STYLES, sel.singingStyle)
    if (style) tags.push(`${style.toLowerCase()} vocals`)
    const lang = labelOf(MUSIC_LANGUAGES, sel.language)
    if (lang) tags.push(`${lang} lyrics`)
  }
  return tags
}
