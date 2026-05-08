/**
 * Instrumentation catalog: instruments (multi-select) + production style +
 * vocal presence. Composed into "[production] [instruments-joined] with [vocalPresence]".
 *
 * `vocalPresence: "instrumental"` is the trigger that the Generate Music
 * (MiniMax) integration uses to flip its `instrumental: true` flag.
 */

export interface InstrumentationEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const INSTRUMENTS: ReadonlyArray<InstrumentationEntry> = [
  { id: "acoustic-guitar", label: "Acoustic Guitar", description: "Steel- or nylon-strung", promptHint: "acoustic guitar" },
  { id: "electric-guitar", label: "Electric Guitar", description: "Solid-body, often distorted", promptHint: "electric guitar" },
  { id: "bass-guitar",     label: "Bass Guitar",     description: "Low-end electric bass",     promptHint: "bass guitar" },
  { id: "piano",           label: "Piano",           description: "Acoustic grand or upright", promptHint: "piano" },
  { id: "electric-piano",  label: "Electric Piano",  description: "Rhodes / Wurlitzer-style",  promptHint: "electric piano" },
  { id: "synthesizer",     label: "Synthesizer",     description: "Analog or digital synth",   promptHint: "synthesizer" },
  { id: "organ",           label: "Organ",           description: "Hammond or pipe organ",     promptHint: "organ" },
  { id: "drums",           label: "Drums",           description: "Acoustic drum kit",         promptHint: "drums" },
  { id: "drum-machine",    label: "Drum Machine",    description: "Programmed beats",          promptHint: "drum machine" },
  { id: "strings",         label: "Strings",         description: "Orchestral string section", promptHint: "string section" },
  { id: "violin",          label: "Violin",          description: "Solo violin",               promptHint: "violin" },
  { id: "cello",           label: "Cello",           description: "Solo cello",                promptHint: "cello" },
  { id: "brass",           label: "Brass",           description: "Trumpet, trombone, etc.",   promptHint: "brass section" },
  { id: "saxophone",       label: "Saxophone",       description: "Solo or section sax",       promptHint: "saxophone" },
  { id: "flute",           label: "Flute",           description: "Concert flute",             promptHint: "flute" },
  { id: "clarinet",        label: "Clarinet",        description: "Solo clarinet",             promptHint: "clarinet" },
  { id: "harp",            label: "Harp",            description: "Concert or folk harp",      promptHint: "harp" },
  { id: "harmonica",       label: "Harmonica",       description: "Blues harp",                promptHint: "harmonica" },
  { id: "banjo",           label: "Banjo",           description: "5-string or tenor",         promptHint: "banjo" },
  { id: "mandolin",        label: "Mandolin",        description: "Folk / bluegrass",          promptHint: "mandolin" },
  { id: "ukulele",         label: "Ukulele",         description: "Soprano-tenor uke",         promptHint: "ukulele" },
  { id: "808",             label: "808",             description: "Roland TR-808 bass",        promptHint: "808 bass" },
  { id: "synth-bass",      label: "Synth Bass",      description: "Synthesized low end",       promptHint: "synth bass" },
  { id: "pads",            label: "Synth Pads",      description: "Sustained synth textures",  promptHint: "synth pads" },
  { id: "arpeggiator",     label: "Arpeggiator",     description: "Sequenced arp patterns",    promptHint: "arpeggiated synth" },
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
] as const

export const VOCAL_PRESENCE: ReadonlyArray<InstrumentationEntry> = [
  { id: "instrumental",    label: "Instrumental",    description: "No vocals",                    promptHint: "instrumental, no vocals" },
  { id: "male-lead",       label: "Male Lead",       description: "Male lead vocal",              promptHint: "male lead vocals" },
  { id: "female-lead",     label: "Female Lead",     description: "Female lead vocal",            promptHint: "female lead vocals" },
  { id: "choir",           label: "Choir",           description: "Choral / ensemble vocals",     promptHint: "choir vocals" },
  { id: "mixed",           label: "Mixed",           description: "Multiple lead vocalists",      promptHint: "mixed lead vocals" },
] as const

const INSTRUMENT_BY_ID = new Map(INSTRUMENTS.map((x) => [x.id, x]))
const PRODUCTION_BY_ID = new Map(PRODUCTION_STYLES.map((x) => [x.id, x]))
const VOCAL_BY_ID = new Map(VOCAL_PRESENCE.map((x) => [x.id, x]))

export function getInstrument(id: string | undefined): InstrumentationEntry | undefined {
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
    .filter((x): x is InstrumentationEntry => !!x)
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
