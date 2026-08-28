/**
 * Canonical catalog of music genres for Suno / MiniMax / Text-to-Audio
 * prompt composition. Shared between frontend (picker UI), backend
 * orchestrator (payload-builder), and frontend DAG executor.
 *
 * Each entry's `promptHint` is the natural-language fragment injected into
 * the consumer's style/prompt field by `composeSoundHintFromConnections`.
 *
 * Top-level genres carry a `category` field used by the picker to render a
 * horizontal tab row (mirrors PersonPicker.ethnicity grouping). Categories
 * are Splice-aligned (https://splice.com/sounds/genres) so the taxonomy
 * matches industry conventions.
 */

import { pickIds } from "@nodaro/shared"

import { resolveTerm, type PickerHintMode } from "./term.js"

export type MusicGenreCategory =
  | "hip-hop-rnb"
  | "electronic"
  | "pop"
  | "rock-metal"
  | "acoustic"
  | "global"
  | "cinematic"

export const MUSIC_GENRE_CATEGORY_ORDER: ReadonlyArray<MusicGenreCategory> = [
  "hip-hop-rnb",
  "electronic",
  "pop",
  "rock-metal",
  "acoustic",
  "global",
  "cinematic",
] as const

export const MUSIC_GENRE_CATEGORY_LABELS: Readonly<Record<MusicGenreCategory, string>> = {
  "hip-hop-rnb": "Hip Hop / R&B",
  "electronic":  "Electronic",
  "pop":         "Pop",
  "rock-metal":  "Rock / Metal",
  "acoustic":    "Acoustic / Roots",
  "global":      "Global",
  "cinematic":   "Cinematic / Score",
}

export interface MusicSubgenre {
  readonly id: string
  readonly label: string
  readonly promptHint: string
  /**
   * Compact professional form injected in COMPACT hint mode (see `term.ts`).
   * Authored where the lowercased label is not the genre name a producer would
   * write — the picker drops the parent genre from the label to keep the tile
   * short ("Conscious" → "conscious hip hop", "Beats" → "lo-fi beats"), the
   * label is a UI compound the derivation mangles ("Drum & Bass",
   * "Trap (EDM)"), or the bare word means something else entirely outside
   * music ("Dub", "Swing", "Romantic"). Everywhere else the label IS the term.
   */
  readonly term?: string
}

export interface MusicGenre {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  /**
   * Compact professional form (see `term.ts`), authored where the lowercased
   * label does not read as a music genre on its own — "World" → "world music",
   * "R&B" → "rhythm and blues". Everywhere else the label IS the term.
   */
  readonly term?: string
  readonly category: MusicGenreCategory
  readonly subgenres: ReadonlyArray<MusicSubgenre>
}

export interface MusicEra {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  /**
   * Compact professional form (see `term.ts`). The decade labels already ARE
   * the term; authored only for the named eras whose label is not what a
   * producer writes ("Futurist" → "futuristic").
   */
  readonly term?: string
}

// Sourced from frontend/src/lib/suno-tags.ts SUNO_TAGS Genre + Subgenre buckets.
export const MUSIC_GENRES: ReadonlyArray<MusicGenre> = [
  // -------- Hip Hop / R&B --------
  {
    id: "hip-hop",
    label: "Hip Hop",
    description: "Rhythmic spoken delivery, sampled or programmed beats",
    promptHint: "hip hop",
    category: "hip-hop-rnb",
    subgenres: [
      { id: "trap",             label: "Trap",             promptHint: "trap" },
      { id: "boom-bap",         label: "Boom Bap",         promptHint: "boom bap hip hop" },
      { id: "lo-fi-hip-hop",    label: "Lo-fi Hip Hop",    promptHint: "lo-fi hip hop" },
      { id: "drill",            label: "Drill",            promptHint: "drill" },
      { id: "uk-drill",         label: "UK Drill",         promptHint: "UK drill" },
      { id: "cloud-rap",        label: "Cloud Rap",        promptHint: "cloud rap" },
      { id: "conscious-rap",    label: "Conscious",        promptHint: "conscious hip hop", term: "conscious hip hop" },
      { id: "gangsta-rap",      label: "Gangsta",          promptHint: "gangsta rap", term: "gangsta rap" },
      { id: "jazz-rap",         label: "Jazz Rap",         promptHint: "jazz rap" },
      { id: "alt-hip-hop",      label: "Alt Hip Hop",      promptHint: "alternative hip hop" },
      { id: "phonk",            label: "Phonk",            promptHint: "phonk" },
      { id: "drift-phonk",      label: "Drift Phonk",      promptHint: "drift phonk" },
      { id: "uk-hip-hop",       label: "UK Hip Hop",       promptHint: "UK hip hop" },
      { id: "grime",            label: "Grime",            promptHint: "grime" },
      { id: "pluggnb",          label: "PluggnB",          promptHint: "pluggnb" },
      { id: "rage",             label: "Rage",             promptHint: "rage hip hop", term: "rage hip hop" },
      { id: "jersey-club",      label: "Jersey Club",      promptHint: "Jersey club" },
      { id: "brazilian-funk",   label: "Brazilian Funk",   promptHint: "Brazilian funk" },
      { id: "moombahton",       label: "Moombahton",       promptHint: "moombahton" },
      { id: "glitch-hop",       label: "Glitch Hop",       promptHint: "glitch hop" },
    ],
  },
  {
    id: "rnb",
    label: "R&B",
    description: "Smooth vocals, soul-influenced",
    promptHint: "R&B",
    term: "rhythm and blues",
    category: "hip-hop-rnb",
    subgenres: [
      { id: "neo-soul",            label: "Neo-Soul",            promptHint: "neo-soul" },
      { id: "contemporary-rnb",    label: "Contemporary R&B",    promptHint: "contemporary R&B", term: "contemporary rhythm and blues" },
      { id: "alt-rnb",             label: "Alt R&B",             promptHint: "alternative R&B", term: "alternative rhythm and blues" },
      { id: "neo-rnb",             label: "Neo R&B",             promptHint: "modern R&B", term: "modern rhythm and blues" },
      { id: "quiet-storm",         label: "Quiet Storm",         promptHint: "quiet storm" },
      { id: "new-jack-swing",      label: "New Jack Swing",      promptHint: "new jack swing" },
      { id: "future-soul",         label: "Future Soul",         promptHint: "future soul" },
    ],
  },
  {
    id: "soul",
    label: "Soul",
    description: "Emotive vocals, gospel-rooted, vintage R&B",
    promptHint: "soul",
    category: "hip-hop-rnb",
    subgenres: [
      { id: "motown",           label: "Motown",           promptHint: "Motown soul" },
      { id: "northern-soul",    label: "Northern Soul",    promptHint: "Northern soul" },
      { id: "southern-soul",    label: "Southern Soul",    promptHint: "Southern soul" },
      { id: "psychedelic-soul", label: "Psychedelic Soul", promptHint: "psychedelic soul" },
    ],
  },
  {
    id: "funk",
    label: "Funk",
    description: "Syncopated bass, percussive grooves",
    promptHint: "funk",
    category: "hip-hop-rnb",
    subgenres: [
      { id: "p-funk",           label: "P-Funk",           promptHint: "P-funk" },
      { id: "g-funk",           label: "G-Funk",           promptHint: "G-funk" },
      { id: "electro-funk",     label: "Electro Funk",     promptHint: "electro-funk" },
      { id: "jazz-funk",        label: "Jazz Funk",        promptHint: "jazz-funk" },
    ],
  },
  {
    id: "lofi",
    label: "Lo-Fi",
    description: "Warm tape hiss, mellow beats, nostalgic",
    promptHint: "lo-fi",
    category: "hip-hop-rnb",
    subgenres: [
      { id: "lofi-beats",       label: "Beats",            promptHint: "lo-fi beats", term: "lo-fi beats" },
      { id: "lofi-jazz",        label: "Jazz",             promptHint: "lo-fi jazz", term: "lo-fi jazz" },
      { id: "chillhop",         label: "Chillhop",         promptHint: "chillhop" },
    ],
  },

  // -------- Electronic --------
  {
    id: "electronic",
    label: "Electronic",
    description: "Synthesizer / sequencer-driven",
    promptHint: "electronic",
    category: "electronic",
    subgenres: [
      { id: "house",            label: "House",            promptHint: "house" },
      { id: "deep-house",       label: "Deep House",       promptHint: "deep house" },
      { id: "tech-house",       label: "Tech House",       promptHint: "tech house" },
      { id: "afro-house",       label: "Afro House",       promptHint: "Afro house" },
      { id: "amapiano",         label: "Amapiano",         promptHint: "amapiano" },
      { id: "techno",           label: "Techno",           promptHint: "techno" },
      { id: "minimal-techno",   label: "Minimal Techno",   promptHint: "minimal techno" },
      { id: "melodic-techno",   label: "Melodic Techno",   promptHint: "melodic techno" },
      { id: "drum-and-bass",    label: "Drum & Bass",      promptHint: "drum and bass", term: "drum and bass" },
      { id: "jungle",           label: "Jungle",           promptHint: "jungle" },
      { id: "dubstep",          label: "Dubstep",          promptHint: "dubstep" },
      { id: "future-bass",      label: "Future Bass",      promptHint: "future bass" },
      { id: "trap-edm",         label: "Trap (EDM)",       promptHint: "trap EDM", term: "trap edm" },
      { id: "synthwave",        label: "Synthwave",        promptHint: "synthwave" },
      { id: "outrun",           label: "Outrun",           promptHint: "outrun synthwave", term: "outrun synthwave" },
      { id: "vaporwave",        label: "Vaporwave",        promptHint: "vaporwave" },
      { id: "trance",           label: "Trance",           promptHint: "trance" },
      { id: "psytrance",        label: "Psytrance",        promptHint: "psytrance" },
      { id: "ambient",          label: "Ambient",          promptHint: "ambient electronic", term: "ambient electronic" },
      { id: "idm",              label: "IDM",              promptHint: "intelligent dance music", term: "intelligent dance music" },
      { id: "breakbeat",        label: "Breakbeat",        promptHint: "breakbeat" },
      { id: "garage-uk",        label: "UK Garage",        promptHint: "UK garage" },
      { id: "hardstyle",        label: "Hardstyle",        promptHint: "hardstyle" },
      { id: "footwork",         label: "Footwork",         promptHint: "footwork" },
      { id: "indie-electronic", label: "Indie Electronic", promptHint: "indie electronic" },
    ],
  },
  {
    id: "industrial",
    label: "Industrial",
    description: "Harsh electronic, mechanical textures, abrasive",
    promptHint: "industrial",
    category: "electronic",
    subgenres: [
      { id: "ebm",              label: "EBM",              promptHint: "electronic body music", term: "electronic body music" },
      { id: "industrial-metal", label: "Industrial Metal", promptHint: "industrial metal" },
      { id: "noise",            label: "Noise",            promptHint: "noise industrial", term: "industrial noise" },
    ],
  },
  {
    id: "ambient-genre",
    label: "Ambient",
    description: "Atmospheric, slow-evolving, often beatless",
    promptHint: "ambient",
    category: "electronic",
    subgenres: [
      { id: "dark-ambient",     label: "Dark Ambient",     promptHint: "dark ambient" },
      { id: "drone",            label: "Drone",            promptHint: "drone" },
      { id: "new-age",          label: "New Age",          promptHint: "new age ambient", term: "new age ambient" },
      { id: "space-music",      label: "Space",            promptHint: "space ambient", term: "space ambient" },
    ],
  },
  {
    id: "experimental",
    label: "Experimental",
    description: "Genre-defying, avant-garde, abstract",
    promptHint: "experimental",
    category: "electronic",
    subgenres: [
      { id: "musique-concrete", label: "Musique Concrète", promptHint: "musique concrète" },
      { id: "noise-music",      label: "Noise",            promptHint: "noise music", term: "noise music" },
      { id: "free-improv",      label: "Free Improv",      promptHint: "free improvisation", term: "free improvisation" },
      { id: "sound-art",        label: "Sound Art",        promptHint: "sound art" },
    ],
  },
  {
    id: "chill",
    label: "Chill",
    description: "Downtempo, relaxed, mellow textures",
    promptHint: "chill",
    category: "electronic",
    subgenres: [
      { id: "chillout",         label: "Chillout",         promptHint: "chillout" },
      { id: "chillwave",        label: "Chillwave",        promptHint: "chillwave" },
      { id: "downtempo",        label: "Downtempo",        promptHint: "downtempo" },
      { id: "trip-hop",         label: "Trip Hop",         promptHint: "trip hop" },
    ],
  },
  {
    id: "disco",
    label: "Disco",
    description: "Four-on-the-floor, lush strings, dancefloor-era",
    promptHint: "disco",
    category: "electronic",
    subgenres: [
      { id: "italo-disco",      label: "Italo Disco",      promptHint: "Italo disco" },
      { id: "nu-disco",         label: "Nu-Disco",         promptHint: "nu-disco" },
      { id: "euro-disco",       label: "Euro Disco",       promptHint: "Euro disco" },
    ],
  },

  // -------- Pop --------
  {
    id: "pop",
    label: "Pop",
    description: "Mainstream, hook-driven",
    promptHint: "pop",
    category: "pop",
    subgenres: [
      { id: "synth-pop",        label: "Synth Pop",        promptHint: "synth pop" },
      { id: "dream-pop",        label: "Dream Pop",        promptHint: "dream pop" },
      { id: "indie-pop",        label: "Indie Pop",        promptHint: "indie pop" },
      { id: "k-pop",            label: "K-Pop",            promptHint: "k-pop" },
      { id: "j-pop",            label: "J-Pop",            promptHint: "j-pop" },
      { id: "art-pop",          label: "Art Pop",          promptHint: "art pop" },
      { id: "bubblegum-pop",    label: "Bubblegum",        promptHint: "bubblegum pop", term: "bubblegum pop" },
      { id: "chamber-pop",      label: "Chamber",          promptHint: "chamber pop", term: "chamber pop" },
      { id: "electro-pop",      label: "Electro Pop",      promptHint: "electro pop" },
      { id: "hyperpop",         label: "Hyperpop",         promptHint: "hyperpop" },
      { id: "power-pop",        label: "Power Pop",        promptHint: "power pop" },
      { id: "bedroom-pop",      label: "Bedroom Pop",      promptHint: "bedroom pop" },
    ],
  },
  {
    id: "anime",
    label: "Anime / J-Rock",
    description: "Japanese animation soundtrack and J-Rock",
    promptHint: "anime",
    term: "anime music",
    category: "pop",
    subgenres: [
      { id: "anime-opening",    label: "Opening",          promptHint: "anime opening", term: "anime opening" },
      { id: "j-rock",           label: "J-Rock",           promptHint: "J-rock" },
      { id: "city-pop",         label: "City Pop",         promptHint: "city pop" },
    ],
  },

  // -------- Rock / Metal --------
  {
    id: "rock",
    label: "Rock",
    description: "Guitar-driven, prominent backbeat",
    promptHint: "rock",
    category: "rock-metal",
    subgenres: [
      { id: "classic-rock",     label: "Classic Rock",     promptHint: "classic rock" },
      { id: "hard-rock",        label: "Hard Rock",        promptHint: "hard rock" },
      { id: "indie-rock",       label: "Indie Rock",       promptHint: "indie rock" },
      { id: "punk-rock",        label: "Punk Rock",        promptHint: "punk rock" },
      { id: "alt-rock",         label: "Alternative",      promptHint: "alternative rock", term: "alternative rock" },
      { id: "psychedelic-rock", label: "Psychedelic",      promptHint: "psychedelic rock", term: "psychedelic rock" },
      { id: "garage-rock",      label: "Garage",           promptHint: "garage rock", term: "garage rock" },
      { id: "surf-rock",        label: "Surf",             promptHint: "surf rock", term: "surf rock" },
      { id: "prog-rock",        label: "Progressive",      promptHint: "progressive rock", term: "progressive rock" },
      { id: "post-rock",        label: "Post-Rock",        promptHint: "post-rock" },
      { id: "shoegaze",         label: "Shoegaze",         promptHint: "shoegaze" },
      { id: "math-rock",        label: "Math Rock",        promptHint: "math rock" },
      { id: "stoner-rock",      label: "Stoner",           promptHint: "stoner rock", term: "stoner rock" },
      { id: "emo",              label: "Emo",              promptHint: "emo" },
    ],
  },
  {
    id: "punk",
    label: "Punk",
    description: "Fast, aggressive, DIY counter-culture",
    promptHint: "punk",
    category: "rock-metal",
    subgenres: [
      { id: "hardcore-punk",    label: "Hardcore",         promptHint: "hardcore punk", term: "hardcore punk" },
      { id: "post-punk",        label: "Post-Punk",        promptHint: "post-punk" },
      { id: "pop-punk",         label: "Pop Punk",         promptHint: "pop punk" },
      { id: "skate-punk",       label: "Skate Punk",       promptHint: "skate punk" },
      { id: "anarcho-punk",     label: "Anarcho",          promptHint: "anarcho-punk", term: "anarcho-punk" },
    ],
  },
  {
    id: "metal",
    label: "Metal",
    description: "Heavy distortion, aggressive vocals",
    promptHint: "metal",
    category: "rock-metal",
    subgenres: [
      { id: "heavy-metal",      label: "Heavy Metal",      promptHint: "heavy metal" },
      { id: "death-metal",      label: "Death Metal",      promptHint: "death metal" },
      { id: "black-metal",      label: "Black Metal",      promptHint: "black metal" },
      { id: "thrash-metal",     label: "Thrash",           promptHint: "thrash metal", term: "thrash metal" },
      { id: "doom-metal",       label: "Doom",             promptHint: "doom metal", term: "doom metal" },
      { id: "power-metal",      label: "Power",            promptHint: "power metal", term: "power metal" },
      { id: "prog-metal",       label: "Progressive",      promptHint: "progressive metal", term: "progressive metal" },
      { id: "metalcore",        label: "Metalcore",        promptHint: "metalcore" },
      { id: "deathcore",        label: "Deathcore",        promptHint: "deathcore" },
      { id: "nu-metal",         label: "Nu-Metal",         promptHint: "nu-metal" },
      { id: "sludge-metal",     label: "Sludge",           promptHint: "sludge metal", term: "sludge metal" },
      { id: "symphonic-metal",  label: "Symphonic",        promptHint: "symphonic metal", term: "symphonic metal" },
    ],
  },

  // -------- Acoustic / Roots --------
  {
    id: "jazz",
    label: "Jazz",
    description: "Improvisation, swing rhythms, complex harmony",
    promptHint: "jazz",
    category: "acoustic",
    subgenres: [
      { id: "bebop",            label: "Bebop",            promptHint: "bebop" },
      { id: "smooth-jazz",      label: "Smooth Jazz",      promptHint: "smooth jazz" },
      { id: "fusion",           label: "Fusion",           promptHint: "jazz fusion", term: "jazz fusion" },
      { id: "cool-jazz",        label: "Cool Jazz",        promptHint: "cool jazz" },
      { id: "free-jazz",        label: "Free Jazz",        promptHint: "free jazz" },
      { id: "swing",            label: "Swing",            promptHint: "swing jazz", term: "swing jazz" },
      { id: "big-band",         label: "Big Band",         promptHint: "big band jazz" },
      { id: "dixieland",        label: "Dixieland",        promptHint: "dixieland jazz" },
      { id: "latin-jazz",       label: "Latin Jazz",       promptHint: "latin jazz" },
      { id: "nu-jazz",          label: "Nu-Jazz",          promptHint: "nu-jazz" },
      { id: "acid-jazz",        label: "Acid Jazz",        promptHint: "acid jazz" },
    ],
  },
  {
    id: "blues",
    label: "Blues",
    description: "12-bar form, expressive vocals, bent notes",
    promptHint: "blues",
    category: "acoustic",
    subgenres: [
      { id: "delta-blues",      label: "Delta Blues",      promptHint: "Delta blues" },
      { id: "chicago-blues",    label: "Chicago Blues",    promptHint: "Chicago blues" },
      { id: "electric-blues",   label: "Electric Blues",   promptHint: "electric blues" },
      { id: "jump-blues",       label: "Jump Blues",       promptHint: "jump blues" },
      { id: "blues-rock",       label: "Blues Rock",       promptHint: "blues rock" },
    ],
  },
  {
    id: "country",
    label: "Country",
    description: "Acoustic, narrative lyrics",
    promptHint: "country",
    category: "acoustic",
    subgenres: [
      { id: "country-pop",      label: "Country Pop",      promptHint: "country pop" },
      { id: "outlaw-country",   label: "Outlaw Country",   promptHint: "outlaw country" },
      { id: "alt-country",      label: "Alt Country",      promptHint: "alt-country" },
      { id: "country-rock",     label: "Country Rock",     promptHint: "country rock" },
      { id: "americana",        label: "Americana",        promptHint: "americana" },
      { id: "honky-tonk",       label: "Honky Tonk",       promptHint: "honky tonk" },
      { id: "bluegrass",        label: "Bluegrass",        promptHint: "bluegrass" },
    ],
  },
  {
    id: "folk",
    label: "Folk",
    description: "Acoustic, traditional instruments",
    promptHint: "folk",
    category: "acoustic",
    subgenres: [
      { id: "indie-folk",       label: "Indie Folk",       promptHint: "indie folk" },
      { id: "traditional-folk", label: "Traditional",      promptHint: "traditional folk", term: "traditional folk" },
      { id: "celtic-folk",      label: "Celtic",           promptHint: "Celtic folk", term: "celtic folk" },
      { id: "freak-folk",       label: "Freak Folk",       promptHint: "freak folk" },
      { id: "folk-rock",        label: "Folk Rock",        promptHint: "folk rock" },
      { id: "anti-folk",        label: "Anti-Folk",        promptHint: "anti-folk" },
    ],
  },
  {
    id: "gospel",
    label: "Gospel",
    description: "Christian devotional, choral, often piano-led",
    promptHint: "gospel",
    category: "acoustic",
    subgenres: [
      { id: "traditional-gospel", label: "Traditional",    promptHint: "traditional gospel", term: "traditional gospel" },
      { id: "contemporary-gospel",label: "Contemporary",   promptHint: "contemporary gospel", term: "contemporary gospel" },
      { id: "urban-gospel",       label: "Urban",          promptHint: "urban gospel", term: "urban gospel" },
    ],
  },

  // -------- Global --------
  {
    id: "reggae",
    label: "Reggae",
    description: "Off-beat rhythm, Jamaican origin",
    promptHint: "reggae",
    category: "global",
    subgenres: [
      { id: "roots-reggae",     label: "Roots",            promptHint: "roots reggae", term: "roots reggae" },
      { id: "dub",              label: "Dub",              promptHint: "dub reggae", term: "dub reggae" },
      { id: "dancehall",        label: "Dancehall",        promptHint: "dancehall" },
      { id: "ska",              label: "Ska",              promptHint: "ska" },
      { id: "rocksteady",       label: "Rocksteady",       promptHint: "rocksteady" },
    ],
  },
  {
    id: "latin",
    label: "Latin",
    description: "Latin American musical traditions",
    promptHint: "latin",
    category: "global",
    subgenres: [
      { id: "salsa",            label: "Salsa",            promptHint: "salsa" },
      { id: "bossa-nova",       label: "Bossa Nova",       promptHint: "bossa nova" },
      { id: "reggaeton",        label: "Reggaeton",        promptHint: "reggaeton" },
      { id: "cumbia",           label: "Cumbia",           promptHint: "cumbia" },
      { id: "merengue",         label: "Merengue",         promptHint: "merengue" },
      { id: "bachata",          label: "Bachata",          promptHint: "bachata" },
      { id: "tango",            label: "Tango",            promptHint: "tango" },
      { id: "mariachi",         label: "Mariachi",         promptHint: "mariachi" },
      { id: "samba",            label: "Samba",            promptHint: "samba" },
      { id: "flamenco",         label: "Flamenco",         promptHint: "flamenco" },
      { id: "latin-pop",        label: "Latin Pop",        promptHint: "latin pop" },
      { id: "latin-trap",       label: "Latin Trap",       promptHint: "latin trap" },
    ],
  },
  {
    id: "world",
    label: "World",
    description: "Non-Western musical traditions",
    promptHint: "world music",
    term: "world music",
    category: "global",
    subgenres: [
      { id: "afrobeat",         label: "Afrobeat",         promptHint: "afrobeat" },
      { id: "afrobeats",        label: "Afrobeats",        promptHint: "afrobeats" },
      { id: "highlife",         label: "Highlife",         promptHint: "highlife" },
      { id: "amapiano-w",       label: "Amapiano",         promptHint: "amapiano" },
      { id: "bhangra",          label: "Bhangra",          promptHint: "bhangra" },
      { id: "bollywood",        label: "Bollywood",        promptHint: "Bollywood" },
      { id: "indian-classical", label: "Indian Classical", promptHint: "Indian classical" },
      { id: "klezmer",          label: "Klezmer",          promptHint: "klezmer" },
      { id: "balkan",           label: "Balkan",           promptHint: "Balkan" },
      { id: "middle-eastern",   label: "Middle Eastern",   promptHint: "middle-eastern" },
      { id: "celtic",           label: "Celtic",           promptHint: "Celtic" },
      { id: "gamelan",          label: "Gamelan",          promptHint: "gamelan" },
      { id: "throat-singing",   label: "Throat Singing",   promptHint: "throat singing" },
    ],
  },

  // -------- Cinematic / Score --------
  {
    id: "classical",
    label: "Classical",
    description: "Orchestral, traditional Western art music",
    promptHint: "classical",
    category: "cinematic",
    subgenres: [
      { id: "baroque",             label: "Baroque",             promptHint: "baroque classical" },
      { id: "romantic",            label: "Romantic",            promptHint: "romantic-era classical", term: "romantic-era classical" },
      { id: "modern-classical",    label: "Modern Classical",    promptHint: "modern classical" },
      { id: "minimalist-classical",label: "Minimalist",          promptHint: "minimalist classical", term: "minimalist classical" },
      { id: "choral",              label: "Choral",              promptHint: "choral classical" },
      { id: "chamber-music",       label: "Chamber",             promptHint: "chamber music", term: "chamber music" },
      { id: "opera",               label: "Opera",               promptHint: "operatic" },
      { id: "early-music",         label: "Early Music",         promptHint: "early music" },
    ],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Score-style, evocative, mood-led",
    promptHint: "cinematic",
    category: "cinematic",
    subgenres: [
      { id: "epic-orchestral",     label: "Epic Orchestral",     promptHint: "epic orchestral cinematic" },
      { id: "minimalist-score",    label: "Minimalist Score",    promptHint: "minimalist cinematic score" },
      { id: "trailer-music",       label: "Trailer",             promptHint: "trailer cinematic music", term: "trailer music" },
      { id: "score-action",        label: "Action",              promptHint: "action film score", term: "action film score" },
      { id: "score-horror",        label: "Horror",              promptHint: "horror film score", term: "horror film score" },
      { id: "score-romance",       label: "Romance",             promptHint: "romantic film score", term: "romantic film score" },
      { id: "score-sci-fi",        label: "Sci-Fi",              promptHint: "sci-fi film score", term: "sci-fi film score" },
      { id: "score-fantasy",       label: "Fantasy",             promptHint: "fantasy film score", term: "fantasy film score" },
      { id: "score-noir",          label: "Noir",                promptHint: "noir cinematic", term: "noir film score" },
      { id: "score-documentary",   label: "Documentary",         promptHint: "documentary score", term: "documentary score" },
    ],
  },
  {
    id: "video-game",
    label: "Video Game",
    description: "Game-score-style — chiptune, orchestral, electronic",
    promptHint: "video game music",
    term: "video game music",
    category: "cinematic",
    subgenres: [
      { id: "chiptune",         label: "Chiptune",         promptHint: "chiptune" },
      { id: "8bit",             label: "8-bit",            promptHint: "8-bit" },
      { id: "16bit",            label: "16-bit",           promptHint: "16-bit" },
      { id: "vgm-orchestral",   label: "Orchestral VGM",   promptHint: "orchestral video game", term: "orchestral video game score" },
      { id: "vgm-synth",        label: "Synth VGM",        promptHint: "synth video game", term: "synth video game score" },
    ],
  },
  {
    id: "holiday",
    label: "Holiday",
    description: "Seasonal — Christmas, festive, traditional",
    promptHint: "holiday",
    category: "cinematic",
    subgenres: [
      { id: "christmas",        label: "Christmas",        promptHint: "Christmas" },
      { id: "winter",           label: "Winter",           promptHint: "winter holiday", term: "winter holiday" },
      { id: "festive",          label: "Festive",          promptHint: "festive" },
    ],
  },
  {
    id: "children",
    label: "Children's",
    description: "Kids music — sing-alongs, lullabies, educational",
    promptHint: "children's music",
    term: "children's music",
    category: "cinematic",
    subgenres: [
      { id: "lullaby",          label: "Lullaby",          promptHint: "lullaby" },
      { id: "nursery-rhyme",    label: "Nursery Rhyme",    promptHint: "nursery rhyme" },
      { id: "kids-pop",         label: "Kids Pop",         promptHint: "kids pop" },
    ],
  },
] as const

export const MUSIC_ERAS: ReadonlyArray<MusicEra> = [
  { id: "1920s", label: "1920s", description: "Roaring Twenties, jazz age", promptHint: "1920s" },
  { id: "1930s", label: "1930s", description: "Big band, swing", promptHint: "1930s" },
  { id: "1940s", label: "1940s", description: "Wartime, bebop emergence", promptHint: "1940s" },
  { id: "1950s", label: "1950s", description: "Early rock & roll, doo-wop", promptHint: "1950s" },
  { id: "1960s", label: "1960s", description: "British invasion, Motown", promptHint: "1960s" },
  { id: "1970s", label: "1970s", description: "Disco, prog rock, punk", promptHint: "1970s" },
  { id: "1980s", label: "1980s", description: "Synth-pop, new wave", promptHint: "1980s" },
  { id: "1990s", label: "1990s", description: "Grunge, hip-hop golden age", promptHint: "1990s" },
  { id: "2000s", label: "2000s", description: "Pop-punk, R&B revival", promptHint: "early 2000s" },
  { id: "2010s", label: "2010s", description: "EDM mainstream, streaming era", promptHint: "2010s" },
  { id: "modern", label: "Modern", description: "2020s+ contemporary", promptHint: "modern" },
  { id: "futurist", label: "Futurist", description: "Sci-fi, otherworldly", promptHint: "futuristic", term: "futuristic" },
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
 * Compact counterpart of a genre's `promptHint`: the short genre name a
 * producer would write ("rhythm and blues", "world music"). Same lookup and
 * same empty-string-on-miss behavior as `getMusicGenre`, so hint mode and
 * compact mode can never disagree about which genre they describe.
 */
export function getMusicGenreTerm(id: string | undefined | null): string {
  return resolveTerm(getMusicGenre(id ?? undefined))
}

/**
 * Compact counterpart for a subgenre. Keeps `getMusicSubgenre`'s two-argument
 * lookup — a subgenre id is unique only within its parent genre, so a
 * single-id term getter could not resolve one.
 */
export function getMusicSubgenreTerm(
  genreId: string | undefined | null,
  subgenreId: string | undefined | null,
): string {
  return resolveTerm(getMusicSubgenre(genreId ?? undefined, subgenreId ?? undefined))
}

/** Compact counterpart of an era's `promptHint` — the short period name. */
export function getMusicEraTerm(id: string | undefined | null): string {
  return resolveTerm(getMusicEra(id ?? undefined))
}

/**
 * Compose hints from MusicGenreData: optional preText, structured
 * [era] [subgenre|genre] (or " / "-joined genres for multi), optional
 * postText. Returns array — caller joins with ", " (matches buildMoodHints
 * / buildPersonHints pattern).
 *
 * Multi-genre (genre is an array): emit each genre's hint joined with " / "
 * — subgenre is ignored in multi-mode (subgenre is meaningful only against
 * a single chosen genre).
 */
export function buildMusicGenreHints(
  data: {
    readonly preText?: string
    readonly postText?: string
    readonly genre?: string | ReadonlyArray<string>
    readonly subgenre?: string
    readonly era?: string
  },
  mode: PickerHintMode = "full",
): string {
  if (mode === "compact") return buildMusicGenreTerms(data)
  const fragments: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) fragments.push(pre)

  const parts: string[] = []
  const era = getMusicEra(data.era)
  if (era) parts.push(era.promptHint)

  const genreIds = pickIds(data.genre)
  if (genreIds.length > 1) {
    const genreHints = genreIds
      .map((id) => getMusicGenre(id)?.promptHint)
      .filter((h): h is string => !!h)
    if (genreHints.length > 0) parts.push(genreHints.join(" / "))
  } else if (genreIds.length === 1) {
    const sub = getMusicSubgenre(genreIds[0], data.subgenre)
    if (sub) {
      parts.push(sub.promptHint)
    } else {
      const genre = getMusicGenre(genreIds[0])
      if (genre) parts.push(genre.promptHint)
    }
  }
  if (parts.length > 0) fragments.push(parts.join(" "))

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) fragments.push(post)

  return fragments.join(", ")
}

/**
 * Compact-mode mirror of `buildMusicGenreHints`: the same preText / [era]
 * [subgenre|genre] / postText structure, built from each entry's short `term`
 * instead of its `promptHint` ("1980s synth pop"). Multi-genre still joins
 * with " / " and still ignores the subgenre, and preText / postText — user
 * free text, not catalog copy — pass through untouched.
 */
export function buildMusicGenreTerms(data: {
  readonly preText?: string
  readonly postText?: string
  readonly genre?: string | ReadonlyArray<string>
  readonly subgenre?: string
  readonly era?: string
}): string {
  const fragments: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) fragments.push(pre)

  const parts: string[] = []
  const era = getMusicEraTerm(data.era)
  if (era) parts.push(era)

  const genreIds = pickIds(data.genre)
  if (genreIds.length > 1) {
    const genreTerms = genreIds.map((id) => getMusicGenreTerm(id)).filter((t) => t.length > 0)
    if (genreTerms.length > 0) parts.push(genreTerms.join(" / "))
  } else if (genreIds.length === 1) {
    const sub = getMusicSubgenreTerm(genreIds[0], data.subgenre)
    if (sub) {
      parts.push(sub)
    } else {
      const genre = getMusicGenreTerm(genreIds[0])
      if (genre) parts.push(genre)
    }
  }
  if (parts.length > 0) fragments.push(parts.join(" "))

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) fragments.push(post)

  return fragments.join(", ")
}

/** Default data when a music-genre node is dropped on canvas. Empty by design — forces a deliberate pick. */
export const MUSIC_GENRE_DEFAULT_DATA: {
  preText?: string
  postText?: string
  genre?: string | ReadonlyArray<string>
  subgenre?: string
  era?: string
} = {}
