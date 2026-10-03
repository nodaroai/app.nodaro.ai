/** The dimension fields of each music / voice catalog that carries art. */
export interface SoundArtFields {
  "music-genre": "genre" | "subgenre" | "era"
  "music-mood": "energy" | "emotion" | "vibe"
  instrumentation: "instruments" | "production" | "vocalPresence" | "singingStyle"
  "voice-character": "age" | "gender" | "language" | "accent" | "timbre"
  "voice-delivery": "pace" | "emotion" | "archetype"
}

export type SoundArtCatalogId = keyof SoundArtFields

/** `emoji/<slug>` or `flags/<code>` — a key of SOUND_ART_FILES. */
export type SoundArtKey = `emoji/${string}` | `flags/${string}`

export type SoundArtMap = {
  readonly [C in SoundArtCatalogId]: {
    readonly [F in SoundArtFields[C]]: Readonly<Record<string, SoundArtKey>>
  }
}
