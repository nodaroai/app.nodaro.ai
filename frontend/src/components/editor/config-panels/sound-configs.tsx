"use client"

import {
  buildMusicGenreHints,
  buildMusicMoodHints,
  buildInstrumentationHints,
  buildVoiceCharacterHints,
  buildVoiceDeliveryHints,
} from "@nodaro/shared"
import type {
  MusicGenreData, MusicMoodData, InstrumentationData,
  VoiceCharacterData, VoiceDeliveryData,
} from "@/types/nodes"
import type { ConfigProps } from "./types"
import { useLocaleDir } from "@/lib/locale-store"
import { LocaleHeader } from "./locale-header"
import { CustomTextRows } from "./custom-text-rows"
import { PromptInjectionPreview } from "./prompt-injection-preview"
import { MusicGenrePicker } from "./music-genre-picker"
import { MusicMoodPicker } from "./music-mood-picker"
import { InstrumentationPicker } from "./instrumentation-picker"
import { VoiceCharacterPicker } from "./voice-character-picker"
import { VoiceDeliveryPicker } from "./voice-delivery-picker"

/** Copy a string|ReadonlyArray<string>|undefined patch field into a fresh
 *  mutable string[] (or pass-through for string/undefined). */
function unfreeze(v: string | ReadonlyArray<string> | undefined): string | string[] | undefined {
  if (v === undefined || typeof v === "string") return v
  return [...v]
}

export function MusicGenreConfig({ data, onUpdate }: ConfigProps<MusicGenreData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildMusicGenreHints(data)} />
      <CustomTextRows
        idPrefix="music-genre"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. cover song, remix"
        postPlaceholder="e.g. with a brass-band breakdown"
        onChange={onUpdate}
      />
      <MusicGenrePicker
        value={{ genre: data.genre, subgenre: data.subgenre, era: data.era }}
        onChange={(patch) => onUpdate(patch)}
      />
    </div>
  )
}

export function MusicMoodConfig({ data, onUpdate }: ConfigProps<MusicMoodData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildMusicMoodHints(data)} />
      <CustomTextRows
        idPrefix="music-mood"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. start mellow"
        postPlaceholder="e.g. building to a triumphant climax"
        onChange={onUpdate}
      />
      <MusicMoodPicker
        value={{ energy: data.energy, emotion: data.emotion, vibe: data.vibe }}
        onChange={(patch) => onUpdate(patch)}
      />
    </div>
  )
}

export function InstrumentationConfig({ data, onUpdate }: ConfigProps<InstrumentationData>) {
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildInstrumentationHints(data)} />
      <CustomTextRows
        idPrefix="instrumentation"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. acoustic intro"
        postPlaceholder="e.g. with subtle string pads underneath"
        onChange={onUpdate}
      />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildVoiceCharacterHints(data)} />
      <CustomTextRows
        idPrefix="voice-character"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. slightly hoarse from a cold"
        postPlaceholder="e.g. with a hint of weariness"
        onChange={onUpdate}
      />
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
  const dir = useLocaleDir()
  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <LocaleHeader />
      <PromptInjectionPreview hints={buildVoiceDeliveryHints(data)} />
      <CustomTextRows
        idPrefix="voice-delivery"
        preText={data.preText}
        postText={data.postText}
        prePlaceholder="e.g. pause, gather composure"
        postPlaceholder="e.g. trail off"
        onChange={onUpdate}
      />
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
