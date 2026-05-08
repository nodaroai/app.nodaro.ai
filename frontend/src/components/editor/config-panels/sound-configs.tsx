"use client"

import type {
  MusicGenreData, MusicMoodData, InstrumentationData,
  VoiceCharacterData, VoiceDeliveryData,
} from "@/types/nodes"
import type { ConfigProps } from "./types"
import { MusicGenrePicker } from "./music-genre-picker"
import { MusicMoodPicker } from "./music-mood-picker"
import { InstrumentationPicker } from "./instrumentation-picker"
import { VoiceCharacterPicker } from "./voice-character-picker"
import { VoiceDeliveryPicker } from "./voice-delivery-picker"

export function MusicGenreConfig({ data, onUpdate }: ConfigProps<MusicGenreData>) {
  return (
    <MusicGenrePicker
      value={{ genre: data.genre, subgenre: data.subgenre, era: data.era }}
      onChange={(patch) => onUpdate(patch)}
    />
  )
}

export function MusicMoodConfig({ data, onUpdate }: ConfigProps<MusicMoodData>) {
  return (
    <MusicMoodPicker
      value={{ energy: data.energy, emotion: data.emotion, vibe: data.vibe }}
      onChange={(patch) => onUpdate(patch)}
    />
  )
}

export function InstrumentationConfig({ data, onUpdate }: ConfigProps<InstrumentationData>) {
  return (
    <InstrumentationPicker
      value={{
        instruments: data.instruments,
        production: data.production,
        vocalPresence: data.vocalPresence,
      }}
      onChange={(patch) => {
        // InstrumentationData.instruments is `string[]` (mutable). The picker
        // emits `ReadonlyArray<string> | undefined` — copy into a fresh array
        // when present so the workflow store doesn't get a frozen reference.
        const out: Partial<InstrumentationData> = {}
        if ("production" in patch) out.production = patch.production
        if ("vocalPresence" in patch) out.vocalPresence = patch.vocalPresence
        if ("instruments" in patch) {
          out.instruments = patch.instruments ? [...patch.instruments] : undefined
        }
        onUpdate(out)
      }}
    />
  )
}

export function VoiceCharacterConfig({ data, onUpdate }: ConfigProps<VoiceCharacterData>) {
  return (
    <VoiceCharacterPicker
      value={{
        age: data.age,
        gender: data.gender,
        accent: data.accent,
        timbre: data.timbre,
      }}
      onChange={(patch) => onUpdate(patch)}
    />
  )
}

export function VoiceDeliveryConfig({ data, onUpdate }: ConfigProps<VoiceDeliveryData>) {
  return (
    <VoiceDeliveryPicker
      value={{
        pace: data.pace,
        emotion: data.emotion,
        archetype: data.archetype,
      }}
      onChange={(patch) => onUpdate(patch)}
    />
  )
}
