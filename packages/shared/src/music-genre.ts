/**
 * Canonical catalog of music genres for Suno / MiniMax / Text-to-Audio
 * prompt composition. Shared between frontend (picker UI), backend
 * orchestrator (payload-builder), and frontend DAG executor.
 *
 * Each entry's `promptHint` is the natural-language fragment injected into
 * the consumer's style/prompt field by `composeSoundHintFromConnections`.
 */

export interface MusicSubgenre {
  readonly id: string
  readonly label: string
  readonly promptHint: string
}

export interface MusicGenre {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  readonly subgenres: ReadonlyArray<MusicSubgenre>
}

export interface MusicEra {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

// Seed list — extend during implementation review.
// Sourced from frontend/src/lib/suno-tags.ts SUNO_TAGS Genre + Subgenre buckets.
export const MUSIC_GENRES: ReadonlyArray<MusicGenre> = [
  {
    id: "rock",
    label: "Rock",
    description: "Guitar-driven, prominent backbeat",
    promptHint: "rock",
    subgenres: [
      { id: "classic-rock",  label: "Classic Rock",  promptHint: "classic rock" },
      { id: "hard-rock",     label: "Hard Rock",     promptHint: "hard rock" },
      { id: "indie-rock",    label: "Indie Rock",    promptHint: "indie rock" },
      { id: "punk-rock",     label: "Punk Rock",     promptHint: "punk rock" },
      { id: "alt-rock",      label: "Alternative",   promptHint: "alternative rock" },
    ],
  },
  {
    id: "pop",
    label: "Pop",
    description: "Mainstream, hook-driven",
    promptHint: "pop",
    subgenres: [
      { id: "synth-pop",     label: "Synth Pop",     promptHint: "synth pop" },
      { id: "dream-pop",     label: "Dream Pop",     promptHint: "dream pop" },
      { id: "indie-pop",     label: "Indie Pop",     promptHint: "indie pop" },
      { id: "k-pop",         label: "K-Pop",         promptHint: "k-pop" },
    ],
  },
  {
    id: "electronic",
    label: "Electronic",
    description: "Synthesizer / sequencer-driven",
    promptHint: "electronic",
    subgenres: [
      { id: "house",         label: "House",         promptHint: "house" },
      { id: "techno",        label: "Techno",        promptHint: "techno" },
      { id: "drum-and-bass", label: "Drum & Bass",   promptHint: "drum and bass" },
      { id: "synthwave",     label: "Synthwave",     promptHint: "synthwave" },
      { id: "outrun",        label: "Outrun",        promptHint: "outrun synthwave" },
      { id: "trance",        label: "Trance",        promptHint: "trance" },
      { id: "ambient",       label: "Ambient",       promptHint: "ambient electronic" },
    ],
  },
  {
    id: "hip-hop",
    label: "Hip Hop",
    description: "Rhythmic spoken delivery, sampled or programmed beats",
    promptHint: "hip hop",
    subgenres: [
      { id: "trap",          label: "Trap",          promptHint: "trap" },
      { id: "boom-bap",      label: "Boom Bap",      promptHint: "boom bap hip hop" },
      { id: "lo-fi-hip-hop", label: "Lo-fi Hip Hop", promptHint: "lo-fi hip hop" },
      { id: "drill",         label: "Drill",         promptHint: "drill" },
    ],
  },
  {
    id: "rnb",
    label: "R&B",
    description: "Smooth vocals, soul-influenced",
    promptHint: "R&B",
    subgenres: [
      { id: "neo-soul",      label: "Neo-Soul",      promptHint: "neo-soul" },
      { id: "contemporary-rnb", label: "Contemporary R&B", promptHint: "contemporary R&B" },
    ],
  },
  {
    id: "jazz",
    label: "Jazz",
    description: "Improvisation, swing rhythms, complex harmony",
    promptHint: "jazz",
    subgenres: [
      { id: "bebop",         label: "Bebop",         promptHint: "bebop" },
      { id: "smooth-jazz",   label: "Smooth Jazz",   promptHint: "smooth jazz" },
      { id: "fusion",        label: "Fusion",        promptHint: "jazz fusion" },
    ],
  },
  {
    id: "blues",
    label: "Blues",
    description: "12-bar form, expressive vocals, bent notes",
    promptHint: "blues",
    subgenres: [],
  },
  {
    id: "country",
    label: "Country",
    description: "Acoustic, narrative lyrics",
    promptHint: "country",
    subgenres: [
      { id: "country-pop",   label: "Country Pop",   promptHint: "country pop" },
      { id: "outlaw-country",label: "Outlaw Country",promptHint: "outlaw country" },
    ],
  },
  {
    id: "folk",
    label: "Folk",
    description: "Acoustic, traditional instruments",
    promptHint: "folk",
    subgenres: [
      { id: "indie-folk",    label: "Indie Folk",    promptHint: "indie folk" },
    ],
  },
  {
    id: "metal",
    label: "Metal",
    description: "Heavy distortion, aggressive vocals",
    promptHint: "metal",
    subgenres: [
      { id: "heavy-metal",   label: "Heavy Metal",   promptHint: "heavy metal" },
      { id: "death-metal",   label: "Death Metal",   promptHint: "death metal" },
      { id: "black-metal",   label: "Black Metal",   promptHint: "black metal" },
    ],
  },
  {
    id: "classical",
    label: "Classical",
    description: "Orchestral, traditional Western art music",
    promptHint: "classical",
    subgenres: [
      { id: "baroque",       label: "Baroque",       promptHint: "baroque classical" },
      { id: "romantic",      label: "Romantic",      promptHint: "romantic-era classical" },
      { id: "modern-classical", label: "Modern Classical", promptHint: "modern classical" },
    ],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Score-style, evocative, mood-led",
    promptHint: "cinematic",
    subgenres: [
      { id: "epic-orchestral", label: "Epic Orchestral", promptHint: "epic orchestral cinematic" },
      { id: "minimalist-score", label: "Minimalist Score", promptHint: "minimalist cinematic score" },
    ],
  },
  {
    id: "reggae",
    label: "Reggae",
    description: "Off-beat rhythm, Jamaican origin",
    promptHint: "reggae",
    subgenres: [],
  },
  {
    id: "latin",
    label: "Latin",
    description: "Latin American musical traditions",
    promptHint: "latin",
    subgenres: [
      { id: "salsa",         label: "Salsa",         promptHint: "salsa" },
      { id: "bossa-nova",    label: "Bossa Nova",    promptHint: "bossa nova" },
      { id: "reggaeton",     label: "Reggaeton",     promptHint: "reggaeton" },
    ],
  },
  {
    id: "world",
    label: "World",
    description: "Non-Western musical traditions",
    promptHint: "world music",
    subgenres: [],
  },
] as const

export const MUSIC_ERAS: ReadonlyArray<MusicEra> = [
  { id: "1950s", label: "1950s", description: "Early rock & roll, doo-wop", promptHint: "1950s" },
  { id: "1960s", label: "1960s", description: "British invasion, Motown", promptHint: "1960s" },
  { id: "1970s", label: "1970s", description: "Disco, prog rock, punk", promptHint: "1970s" },
  { id: "1980s", label: "1980s", description: "Synth-pop, new wave", promptHint: "1980s" },
  { id: "1990s", label: "1990s", description: "Grunge, hip-hop golden age", promptHint: "1990s" },
  { id: "2000s", label: "2000s", description: "Pop-punk, R&B revival", promptHint: "early 2000s" },
  { id: "2010s", label: "2010s", description: "EDM mainstream, streaming era", promptHint: "2010s" },
  { id: "modern", label: "Modern", description: "2020s+ contemporary", promptHint: "modern" },
] as const

const GENRE_BY_ID = new Map(MUSIC_GENRES.map((g) => [g.id, g]))
const ERA_BY_ID = new Map(MUSIC_ERAS.map((e) => [e.id, e]))

export function getMusicGenre(id: string | undefined): MusicGenre | undefined {
  if (!id) return undefined
  return GENRE_BY_ID.get(id)
}

export function getMusicGenreLabel(id: string | undefined): string {
  if (!id) return ""
  return GENRE_BY_ID.get(id)?.label ?? id
}

export function getMusicSubgenre(
  genreId: string | undefined,
  subgenreId: string | undefined,
): MusicSubgenre | undefined {
  if (!genreId || !subgenreId) return undefined
  const genre = GENRE_BY_ID.get(genreId)
  return genre?.subgenres.find((s) => s.id === subgenreId)
}

export function getMusicEra(id: string | undefined): MusicEra | undefined {
  if (!id) return undefined
  return ERA_BY_ID.get(id)
}

/**
 * Compose an adjective stack: [era] [subgenre|genre]. Example:
 *   { genre: "electronic", subgenre: "outrun", era: "1980s" } → "1980s outrun synthwave"
 *
 * Empty/unknown sub-fields are skipped. Returns "" when nothing resolves.
 * Subgenre supersedes the base genre hint (the subgenre hint is more specific).
 */
export function buildMusicGenreHints(data: {
  readonly genre?: string
  readonly subgenre?: string
  readonly era?: string
}): string {
  const parts: string[] = []
  const era = getMusicEra(data.era)
  if (era) parts.push(era.promptHint)
  const sub = getMusicSubgenre(data.genre, data.subgenre)
  if (sub) {
    parts.push(sub.promptHint)
  } else {
    const genre = getMusicGenre(data.genre)
    if (genre) parts.push(genre.promptHint)
  }
  return parts.join(" ")
}

/** Default data when a music-genre node is dropped on canvas. Empty by design — forces a deliberate pick. */
export const MUSIC_GENRE_DEFAULT_DATA: { genre?: string; subgenre?: string; era?: string } = {}
