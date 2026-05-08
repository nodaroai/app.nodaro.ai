/**
 * Instrumentation catalog: instruments (multi-select) + production style +
 * vocal presence. Composed into "[production] [instruments-joined] with [vocalPresence]".
 *
 * `vocalPresence: "instrumental"` is the trigger that the Generate Music
 * (MiniMax) integration uses to flip its `instrumental: true` flag.
 *
 * INSTRUMENTS carries a `category` field used by the picker to render a
 * horizontal tab row mirroring Splice's instrument taxonomy
 * (https://splice.com/sounds/instruments) — Drums / Percussion / Keys /
 * Synth / Guitar / Bass / Brass / Woodwinds / Strings / World.
 */

export type InstrumentCategory =
  | "drums"
  | "percussion"
  | "keys"
  | "synth"
  | "guitar"
  | "bass"
  | "brass"
  | "woodwinds"
  | "strings"
  | "world"

export const INSTRUMENT_CATEGORY_ORDER: ReadonlyArray<InstrumentCategory> = [
  "drums", "percussion", "keys", "synth", "guitar", "bass",
  "brass", "woodwinds", "strings", "world",
] as const

export const INSTRUMENT_CATEGORY_LABELS: Readonly<Record<InstrumentCategory, string>> = {
  drums: "Drums",
  percussion: "Percussion",
  keys: "Keys",
  synth: "Synth",
  guitar: "Guitar",
  bass: "Bass",
  brass: "Brass",
  woodwinds: "Woodwinds",
  strings: "Strings",
  world: "World",
}

export interface InstrumentationEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export interface CategorizedInstrument extends InstrumentationEntry {
  readonly category: InstrumentCategory
}

export const INSTRUMENTS: ReadonlyArray<CategorizedInstrument> = [
  // -------- Drums --------
  { id: "drums",           label: "Drums",           description: "Acoustic drum kit",         promptHint: "drums",                category: "drums" },
  { id: "drum-machine",    label: "Drum Machine",    description: "Programmed beats",          promptHint: "drum machine",         category: "drums" },
  { id: "808",             label: "808",             description: "Roland TR-808 bass + kit",  promptHint: "808 drums",            category: "drums" },
  { id: "live-drums",      label: "Live Drums",      description: "Recorded acoustic kit",     promptHint: "live drums",           category: "drums" },
  { id: "breakbeats",      label: "Breakbeats",      description: "Sampled drum loops",        promptHint: "breakbeats",           category: "drums" },
  { id: "trap-drums",      label: "Trap Drums",      description: "Hi-hat rolls + 808",        promptHint: "trap drums",           category: "drums" },

  // -------- Percussion --------
  { id: "bongos",          label: "Bongos",          description: "Pair of small Cuban drums", promptHint: "bongos",               category: "percussion" },
  { id: "conga",           label: "Conga",           description: "Tall single-headed drum",   promptHint: "conga",                category: "percussion" },
  { id: "djembe",          label: "Djembe",          description: "Goblet-shaped West African",promptHint: "djembe",               category: "percussion" },
  { id: "timbales",        label: "Timbales",        description: "Cuban paired metal drums",  promptHint: "timbales",             category: "percussion" },
  { id: "tambourine",      label: "Tambourine",      description: "Hand-shaken jingles",       promptHint: "tambourine",           category: "percussion" },
  { id: "shaker",          label: "Shaker",          description: "Filled rattle",             promptHint: "shaker",               category: "percussion" },
  { id: "cowbell",         label: "Cowbell",         description: "Hand-held cowbell",         promptHint: "cowbell",              category: "percussion" },
  { id: "maracas",         label: "Maracas",         description: "Latin shaker pair",         promptHint: "maracas",              category: "percussion" },
  { id: "claves",          label: "Claves",          description: "Wooden sticks",             promptHint: "claves",               category: "percussion" },
  { id: "marimba",         label: "Marimba",         description: "Wooden mallet keyboard",    promptHint: "marimba",              category: "percussion" },
  { id: "vibraphone",      label: "Vibraphone",      description: "Electric-resonator mallet", promptHint: "vibraphone",           category: "percussion" },
  { id: "xylophone",       label: "Xylophone",       description: "Wooden mallet, bright",     promptHint: "xylophone",            category: "percussion" },
  { id: "glockenspiel",    label: "Glockenspiel",    description: "High-pitched mallet bells", promptHint: "glockenspiel",         category: "percussion" },
  { id: "timpani",         label: "Timpani",         description: "Large orchestral kettledrum", promptHint: "timpani",            category: "percussion" },
  { id: "taiko",           label: "Taiko",           description: "Japanese ensemble drum",    promptHint: "taiko",                category: "percussion" },
  { id: "frame-drum",      label: "Frame Drum",      description: "Shallow round drum",        promptHint: "frame drum",           category: "percussion" },
  { id: "cajon",           label: "Cajón",           description: "Box-shaped Peruvian drum",  promptHint: "cajón",                category: "percussion" },

  // -------- Keys --------
  { id: "piano",           label: "Piano",           description: "Acoustic grand or upright", promptHint: "piano",                category: "keys" },
  { id: "electric-piano",  label: "Electric Piano",  description: "Rhodes / Wurlitzer-style",  promptHint: "electric piano",       category: "keys" },
  { id: "wurlitzer",       label: "Wurlitzer",       description: "Vintage Wurlitzer EP",      promptHint: "Wurlitzer electric piano", category: "keys" },
  { id: "rhodes",          label: "Rhodes",          description: "Vintage Rhodes EP",         promptHint: "Rhodes electric piano",category: "keys" },
  { id: "clavinet",        label: "Clavinet",        description: "Funky Hohner D6",           promptHint: "clavinet",             category: "keys" },
  { id: "organ",           label: "Organ",           description: "Hammond or pipe organ",     promptHint: "organ",                category: "keys" },
  { id: "hammond-organ",   label: "Hammond B3",      description: "Soul / rock B3 organ",      promptHint: "Hammond B3 organ",     category: "keys" },
  { id: "pipe-organ",      label: "Pipe Organ",      description: "Cathedral / church",        promptHint: "pipe organ",           category: "keys" },
  { id: "accordion",       label: "Accordion",       description: "Bellows-driven reed",       promptHint: "accordion",            category: "keys" },
  { id: "mellotron",       label: "Mellotron",       description: "Tape-loop keyboard",        promptHint: "mellotron",            category: "keys" },
  { id: "harpsichord",     label: "Harpsichord",     description: "Plucked-string keyboard",   promptHint: "harpsichord",          category: "keys" },
  { id: "celesta",         label: "Celesta",         description: "Bell-like keyboard",        promptHint: "celesta",              category: "keys" },

  // -------- Synth --------
  { id: "synthesizer",     label: "Synthesizer",     description: "Analog or digital synth",   promptHint: "synthesizer",          category: "synth" },
  { id: "lead-synth",      label: "Lead Synth",      description: "Cutting melodic synth",     promptHint: "lead synth",           category: "synth" },
  { id: "pluck-synth",     label: "Pluck Synth",     description: "Short, plucked timbre",     promptHint: "pluck synth",          category: "synth" },
  { id: "pads",            label: "Synth Pads",      description: "Sustained synth textures",  promptHint: "synth pads",           category: "synth" },
  { id: "arpeggiator",     label: "Arpeggiator",     description: "Sequenced arp patterns",    promptHint: "arpeggiated synth",    category: "synth" },
  { id: "vocoder",          label: "Vocoder",          description: "Voice-modulated synth",   promptHint: "vocoder",              category: "synth" },
  { id: "talkbox",         label: "Talkbox",         description: "Mouth-shaped synth",        promptHint: "talkbox",              category: "synth" },
  { id: "modular-synth",   label: "Modular",         description: "Patchable analog synth",    promptHint: "modular synth",        category: "synth" },
  { id: "fm-synth",        label: "FM Synth",        description: "Frequency-modulation synth",promptHint: "FM synth",             category: "synth" },
  { id: "wavetable-synth", label: "Wavetable",       description: "Wavetable-scanning synth",  promptHint: "wavetable synth",      category: "synth" },
  { id: "stab-synth",      label: "Stab",            description: "Short, percussive chord",   promptHint: "synth stab",           category: "synth" },

  // -------- Guitar --------
  { id: "acoustic-guitar", label: "Acoustic Guitar", description: "Steel- or nylon-strung",    promptHint: "acoustic guitar",      category: "guitar" },
  { id: "electric-guitar", label: "Electric Guitar", description: "Solid-body, often distorted", promptHint: "electric guitar",    category: "guitar" },
  { id: "classical-guitar",label: "Classical Guitar",description: "Nylon-string, fingerstyle", promptHint: "classical guitar",     category: "guitar" },
  { id: "12-string-guitar",label: "12-String",       description: "Doubled-course strum",      promptHint: "12-string guitar",     category: "guitar" },
  { id: "pedal-steel",     label: "Pedal Steel",     description: "Country sliding steel",     promptHint: "pedal steel",          category: "guitar" },
  { id: "lap-steel",       label: "Lap Steel",       description: "Hawaiian lap-played steel", promptHint: "lap steel",            category: "guitar" },
  { id: "dobro",           label: "Dobro",           description: "Resonator guitar",          promptHint: "dobro resonator",      category: "guitar" },
  { id: "banjo",           label: "Banjo",           description: "5-string or tenor",         promptHint: "banjo",                category: "guitar" },
  { id: "mandolin",        label: "Mandolin",        description: "Folk / bluegrass",          promptHint: "mandolin",             category: "guitar" },
  { id: "ukulele",         label: "Ukulele",         description: "Soprano-tenor uke",         promptHint: "ukulele",              category: "guitar" },

  // -------- Bass --------
  { id: "bass-guitar",     label: "Bass Guitar",     description: "Low-end electric bass",     promptHint: "bass guitar",          category: "bass" },
  { id: "synth-bass",      label: "Synth Bass",      description: "Synthesized low end",       promptHint: "synth bass",           category: "bass" },
  { id: "sub-bass",        label: "Sub Bass",        description: "Deep sine sub frequencies", promptHint: "sub bass",             category: "bass" },
  { id: "acoustic-bass",   label: "Acoustic Bass",   description: "Acoustic bass guitar",      promptHint: "acoustic bass",        category: "bass" },
  { id: "upright-bass",    label: "Upright Bass",    description: "Double bass, jazz-style",   promptHint: "upright bass",         category: "bass" },
  { id: "fretless-bass",   label: "Fretless Bass",   description: "Sliding bass guitar",       promptHint: "fretless bass",        category: "bass" },
  { id: "acid-bass",       label: "Acid Bass",       description: "TB-303 squelch",            promptHint: "acid bass",            category: "bass" },
  { id: "wobble-bass",     label: "Wobble Bass",     description: "LFO-modulated dubstep",     promptHint: "wobble bass",          category: "bass" },
  { id: "reese-bass",      label: "Reese Bass",      description: "Detuned drum-and-bass",     promptHint: "Reese bass",           category: "bass" },

  // -------- Brass --------
  { id: "brass",           label: "Brass Section",   description: "Trumpet, trombone, etc.",   promptHint: "brass section",        category: "brass" },
  { id: "trumpet",         label: "Trumpet",         description: "Solo trumpet",              promptHint: "trumpet",              category: "brass" },
  { id: "trombone",        label: "Trombone",        description: "Solo trombone",             promptHint: "trombone",             category: "brass" },
  { id: "french-horn",     label: "French Horn",     description: "Mellow brass",              promptHint: "french horn",          category: "brass" },
  { id: "tuba",            label: "Tuba",            description: "Lowest brass",              promptHint: "tuba",                 category: "brass" },
  { id: "saxophone",       label: "Saxophone",       description: "Solo or section sax",       promptHint: "saxophone",            category: "brass" },
  { id: "flugelhorn",      label: "Flugelhorn",      description: "Mellow trumpet cousin",     promptHint: "flugelhorn",           category: "brass" },
  { id: "cornet",          label: "Cornet",          description: "Brass band cornet",         promptHint: "cornet",               category: "brass" },
  { id: "muted-trumpet",   label: "Muted Trumpet",   description: "Muted jazz trumpet",        promptHint: "muted trumpet",        category: "brass" },

  // -------- Woodwinds --------
  { id: "flute",           label: "Flute",           description: "Concert flute",             promptHint: "flute",                category: "woodwinds" },
  { id: "clarinet",        label: "Clarinet",        description: "Solo clarinet",             promptHint: "clarinet",             category: "woodwinds" },
  { id: "harmonica",       label: "Harmonica",       description: "Blues harp",                promptHint: "harmonica",            category: "woodwinds" },
  { id: "oboe",            label: "Oboe",            description: "Reed-driven, plaintive",    promptHint: "oboe",                 category: "woodwinds" },
  { id: "bassoon",         label: "Bassoon",         description: "Low double-reed",           promptHint: "bassoon",              category: "woodwinds" },
  { id: "english-horn",    label: "English Horn",    description: "Tenor oboe",                promptHint: "english horn",         category: "woodwinds" },
  { id: "piccolo",         label: "Piccolo",         description: "High flute",                promptHint: "piccolo",              category: "woodwinds" },
  { id: "recorder",        label: "Recorder",        description: "Soft-toned woodwind",       promptHint: "recorder",             category: "woodwinds" },
  { id: "pan-flute",       label: "Pan Flute",       description: "Andean pipe flute",         promptHint: "pan flute",            category: "woodwinds" },

  // -------- Strings --------
  { id: "strings",         label: "String Section",  description: "Orchestral string section", promptHint: "string section",       category: "strings" },
  { id: "violin",          label: "Violin",          description: "Solo violin",               promptHint: "violin",               category: "strings" },
  { id: "viola",           label: "Viola",           description: "Solo viola",                promptHint: "viola",                category: "strings" },
  { id: "cello",           label: "Cello",           description: "Solo cello",                promptHint: "cello",                category: "strings" },
  { id: "double-bass",     label: "Double Bass",     description: "Orchestral upright bass",   promptHint: "double bass",          category: "strings" },
  { id: "harp",            label: "Harp",            description: "Concert or folk harp",      promptHint: "harp",                 category: "strings" },
  { id: "pizzicato-strings",label: "Pizzicato",      description: "Plucked strings",           promptHint: "pizzicato strings",    category: "strings" },
  { id: "staccato-strings",label: "Staccato",        description: "Short, punchy strings",     promptHint: "staccato strings",     category: "strings" },
  { id: "fiddle",          label: "Fiddle",          description: "Folk-style violin",         promptHint: "fiddle",               category: "strings" },

  // -------- World --------
  { id: "sitar",           label: "Sitar",           description: "Indian long-necked",        promptHint: "sitar",                category: "world" },
  { id: "tabla",           label: "Tabla",           description: "Indian hand drums",         promptHint: "tabla",                category: "world" },
  { id: "steel-drum",      label: "Steel Drum",      description: "Trinidadian steelpan",      promptHint: "steel drum",           category: "world" },
  { id: "kalimba",         label: "Kalimba",         description: "African thumb piano",       promptHint: "kalimba",              category: "world" },
  { id: "bagpipes",        label: "Bagpipes",        description: "Scottish pipes",            promptHint: "bagpipes",             category: "world" },
  { id: "didgeridoo",      label: "Didgeridoo",      description: "Australian wind",           promptHint: "didgeridoo",           category: "world" },
  { id: "oud",             label: "Oud",             description: "Middle Eastern lute",       promptHint: "oud",                  category: "world" },
  { id: "erhu",            label: "Erhu",            description: "Chinese 2-string fiddle",   promptHint: "erhu",                 category: "world" },
  { id: "koto",            label: "Koto",            description: "Japanese zither",           promptHint: "koto",                 category: "world" },
  { id: "shakuhachi",      label: "Shakuhachi",      description: "Japanese end-blown flute",  promptHint: "shakuhachi",           category: "world" },
  { id: "shamisen",        label: "Shamisen",        description: "Japanese 3-string lute",    promptHint: "shamisen",             category: "world" },
  { id: "duduk",           label: "Duduk",           description: "Armenian double-reed",      promptHint: "duduk",                category: "world" },
  { id: "balalaika",       label: "Balalaika",       description: "Russian triangular lute",   promptHint: "balalaika",            category: "world" },
  { id: "bouzouki",        label: "Bouzouki",        description: "Greek long-necked lute",    promptHint: "bouzouki",             category: "world" },
  { id: "kora",            label: "Kora",            description: "West African 21-string",    promptHint: "kora",                 category: "world" },
  { id: "hang-drum",       label: "Hang Drum",       description: "Steel hand pan",            promptHint: "hang drum",            category: "world" },
] as const

export const PRODUCTION_STYLES: ReadonlyArray<InstrumentationEntry> = [
  { id: "polished",        label: "Polished",        description: "Pristine, mainstream production", promptHint: "polished production" },
  { id: "lo-fi",           label: "Lo-fi",           description: "Warm tape hiss, imperfect",       promptHint: "lo-fi production" },
  { id: "raw",             label: "Raw",             description: "Unfiltered, live feel",           promptHint: "raw production" },
  { id: "vintage",         label: "Vintage",         description: "Analog warmth",                   promptHint: "vintage production" },
  { id: "modern",          label: "Modern",          description: "Contemporary digital",            promptHint: "modern production" },
  { id: "minimalist",      label: "Minimalist",      description: "Sparse, restrained",              promptHint: "minimalist production" },
  { id: "wall-of-sound",   label: "Wall of Sound",   description: "Dense, layered",                  promptHint: "wall-of-sound production" },
  { id: "ambient",         label: "Ambient",         description: "Atmospheric, reverbed",           promptHint: "ambient production" },
  { id: "garage-band",     label: "Garage Band",     description: "DIY, basement-tracked",           promptHint: "garage band production" },
  { id: "live-recording",  label: "Live",            description: "Live concert / room sound",       promptHint: "live recording" },
  { id: "demo-quality",    label: "Demo",            description: "Rough demo aesthetic",            promptHint: "demo quality" },
  { id: "studio-pristine", label: "Studio Pristine", description: "Hi-fi reference quality",         promptHint: "pristine studio production" },
  { id: "tape-saturated",  label: "Tape Saturated",  description: "Analog tape warmth + drive",      promptHint: "tape-saturated" },
  { id: "8-bit-retro",     label: "8-bit Retro",     description: "Lo-bitrate retro game audio",     promptHint: "8-bit retro production" },
] as const

export const VOCAL_PRESENCE: ReadonlyArray<InstrumentationEntry> = [
  { id: "instrumental",    label: "Instrumental",    description: "No vocals",                        promptHint: "instrumental, no vocals" },
  { id: "male-lead",       label: "Male Lead",       description: "Male lead vocal",                  promptHint: "male lead vocals" },
  { id: "female-lead",     label: "Female Lead",     description: "Female lead vocal",                promptHint: "female lead vocals" },
  { id: "androgynous-lead",label: "Androgynous",     description: "Gender-neutral lead",              promptHint: "androgynous lead vocals" },
  { id: "duet",            label: "Duet",            description: "Two lead vocalists",               promptHint: "duet lead vocals" },
  { id: "choir",           label: "Choir",           description: "Choral / ensemble vocals",         promptHint: "choir vocals" },
  { id: "gospel-choir",    label: "Gospel Choir",    description: "Gospel-style choir backing",       promptHint: "gospel choir" },
  { id: "harmony-stack",   label: "Harmony Stack",   description: "Stacked vocal harmonies",          promptHint: "stacked vocal harmonies" },
  { id: "rapper-lead",     label: "Rapper",          description: "Rap lead",                         promptHint: "rap lead vocals" },
  { id: "spoken-word",     label: "Spoken Word",     description: "Spoken / poetry over music",       promptHint: "spoken word" },
  { id: "vocal-chops",     label: "Vocal Chops",     description: "Sliced sample vocals",             promptHint: "vocal chops" },
  { id: "mixed",           label: "Mixed",           description: "Multiple lead vocalists",          promptHint: "mixed lead vocals" },
] as const

const INSTRUMENT_BY_ID = new Map(INSTRUMENTS.map((x) => [x.id, x]))
const PRODUCTION_BY_ID = new Map(PRODUCTION_STYLES.map((x) => [x.id, x]))
const VOCAL_BY_ID = new Map(VOCAL_PRESENCE.map((x) => [x.id, x]))

export function getInstrument(id: string | undefined): CategorizedInstrument | undefined {
  return id ? INSTRUMENT_BY_ID.get(id) : undefined
}
export function getProductionStyle(id: string | undefined): InstrumentationEntry | undefined {
  return id ? PRODUCTION_BY_ID.get(id) : undefined
}
export function getVocalPresence(id: string | undefined): InstrumentationEntry | undefined {
  return id ? VOCAL_BY_ID.get(id) : undefined
}

export function buildInstrumentationHints(data: {
  readonly instruments?: ReadonlyArray<string>
  readonly production?: string
  readonly vocalPresence?: string
}): string {
  const segments: string[] = []
  const prod = getProductionStyle(data.production)
  if (prod) segments.push(prod.promptHint)

  const insts = (data.instruments ?? [])
    .map((id) => getInstrument(id))
    .filter((x): x is CategorizedInstrument => !!x)
  if (insts.length > 0) segments.push(insts.map((x) => x.promptHint).join(", "))

  const vocal = getVocalPresence(data.vocalPresence)
  if (vocal) {
    if (segments.length > 0) {
      return `${segments.join(" ")} with ${vocal.promptHint}`
    }
    return vocal.promptHint
  }
  return segments.join(" ")
}

export const INSTRUMENTATION_DEFAULT_DATA: {
  instruments?: ReadonlyArray<string>; production?: string; vocalPresence?: string
} = { instruments: [] }
