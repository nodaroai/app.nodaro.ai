import type { SunoSeparateStemField, SunoSeparateType } from "@nodaro/shared/models"
import type { MessageKey } from "@/lib/i18n"

/**
 * Suno Separate's display copy, keyed by the shared contract so a new mode or
 * stem field is a type error here rather than a blank label. The panel's mode
 * select and the card's quick-strip pill both list the modes from
 * `SUNO_SEPARATE_TYPES` with these labels.
 */
export const SUNO_SEPARATE_TYPE_LABEL_KEYS: Readonly<Record<SunoSeparateType, MessageKey>> = {
  separate_vocal: "audiocfg.vocalInstrumental",
  split_stem: "audiocfg.twelveStems",
  split_stem_advanced: "audiocfg.oneInstrument",
}

/** The label of each stem a run can return (Audio Separation's labels where they exist). */
export const SUNO_SEPARATE_STEM_LABEL_KEYS: Readonly<Record<SunoSeparateStemField, MessageKey>> = {
  vocalUrl: "audiocfg.vocals",
  instrumentalUrl: "audiocfg.instrumental",
  backingVocalsUrl: "node.stemBackingVocals",
  drumsUrl: "node.stemDrums",
  bassUrl: "node.stemBass",
  guitarUrl: "node.stemGuitar",
  pianoUrl: "node.stemPiano",
  keyboardUrl: "node.stemKeyboard",
  percussionUrl: "node.stemPercussion",
  stringsUrl: "node.stemStrings",
  synthUrl: "node.stemSynth",
  fxUrl: "node.stemFx",
  brassUrl: "node.stemBrass",
  woodwindsUrl: "node.stemWoodwinds",
  otherUrl: "cat.other",
}
