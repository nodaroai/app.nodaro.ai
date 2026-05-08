"use client"

import type {
  MusicGenreData, MusicMoodData, InstrumentationData,
  VoiceCharacterData, VoiceDeliveryData,
} from "@/types/nodes"
import type { ConfigProps } from "./types"
import { LocaleHeader } from "./locale-header"
import { MusicGenrePicker } from "./music-genre-picker"
import { MusicMoodPicker } from "./music-mood-picker"
import { InstrumentationPicker } from "./instrumentation-picker"
import { VoiceCharacterPicker } from "./voice-character-picker"
import { VoiceDeliveryPicker } from "./voice-delivery-picker"

/** Copy a string|ReadonlyArray<string>|undefined patch field into a fresh
 *  mutable string[] (or pass-through for string/undefined). The picker
 *  components emit ReadonlyArray for the multi-pick fields; the workflow
 *  store expects mutable arrays so legacy mutation paths don't fail on a
 *  frozen reference. */
function unfreeze(v: string | ReadonlyArray<string> | undefined): string | string[] | undefined {
  if (v === undefined || typeof v === "string") return v
  return [...v]
}

export function MusicGenreConfig({ data, onUpdate }: ConfigProps<MusicGenreData>) {
  return (
    <div className="flex flex-col gap-3">
      <LocaleHeader />
      <MusicGenrePicker
        value={{ genre: data.genre, subgenre: data.subgenre, era: data.era }}
        onChange={(patch) => onUpdate(patch)}
      />
    </div>
  )
}

export function MusicMoodConfig({ data, onUpdate }: ConfigProps<MusicMoodData>) {
  return (
    <div className="flex flex-col gap-3">
      <LocaleHeader />
      <MusicMoodPicker
        value={{ energy: data.energy, emotion: data.emotion, vibe: data.vibe }}
        onChange={(patch) => onUpdate(patch)}
      />
    </div>
  )
}

export function InstrumentationConfig({ data, onUpdate }: ConfigProps<InstrumentationData>) {
  return (
    <div className="flex flex-col gap-3">
      <LocaleHeader />
      <InstrumentationPicker
        value={{
          instruments: data.instruments,
          production: data.production,
          vocalPresence: data.vocalPresence,
          singingStyle: data.singingStyle,
        }}
        onChange={(patch) => {
          const out: Partial<InstrumentationData> = {}
          if ("production" in patch) out.production = patch.production
          if ("instruments" in patch) {
            out.instruments = patch.instruments ? [...patch.instruments] : undefined
          }
          if ("vocalPresence" in patch) out.vocalPresence = unfreeze(patch.vocalPresence)
          if ("singingStyle" in patch) out.singingStyle = unfreeze(patch.singingStyle)
          onUpdate(out)
        }}
      />
    </div>
  )
}

export function VoiceCharacterConfig({ data, onUpdate }: ConfigProps<VoiceCharacterData>) {
  return (
    <div className="flex flex-col gap-3">
      <LocaleHeader />
      <VoiceCharacterPicker
        value={{
          age: data.age,
          gender: data.gender,
          language: data.language,
          accent: data.accent,
          timbre: data.timbre,
        }}
        onChange={(patch) => {
          const out: Partial<VoiceCharacterData> = {}
          if ("age" in patch) out.age = patch.age
          if ("gender" in patch) out.gender = patch.gender
          if ("accent" in patch) out.accent = patch.accent
          if ("timbre" in patch) out.timbre = patch.timbre
          if ("language" in patch) out.language = unfreeze(patch.language)
          onUpdate(out)
        }}
      />
    </div>
  )
}

export function VoiceDeliveryConfig({ data, onUpdate }: ConfigProps<VoiceDeliveryData>) {
  return (
    <div className="flex flex-col gap-3">
      <LocaleHeader />
      <VoiceDeliveryPicker
        value={{
          pace: data.pace,
          emotion: data.emotion,
          archetype: data.archetype,
        }}
        onChange={(patch) => onUpdate(patch)}
      />
    </div>
  )
}
