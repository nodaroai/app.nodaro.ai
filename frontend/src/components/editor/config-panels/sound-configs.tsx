"use client"

import { useMemo } from "react"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  MUSIC_GENRES, MUSIC_ERAS, getMusicGenre,
  MUSIC_ENERGIES, MUSIC_EMOTIONS, MUSIC_VIBES,
  INSTRUMENTS, PRODUCTION_STYLES, VOCAL_PRESENCE,
  VOICE_AGES, VOICE_GENDERS, VOICE_ACCENTS, VOICE_TIMBRES,
  VOICE_PACES, VOICE_EMOTIONS, VOICE_ARCHETYPES,
} from "@nodaro/shared"
import { useMultiPick, type MultiPickValue } from "./multi-pick-ui"
import type {
  MusicGenreData, MusicMoodData, InstrumentationData,
  VoiceCharacterData, VoiceDeliveryData,
} from "@/types/nodes"
import type { ConfigProps } from "./types"

function pickerRow<T extends string>(
  label: string,
  options: ReadonlyArray<{ id: T; label: string; description?: string }>,
  value: T | undefined,
  onChange: (next: T | undefined) => void,
) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <Select
        value={value ?? ""}
        onValueChange={(v) => onChange((v || undefined) as T | undefined)}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={`Pick ${label.toLowerCase()}`} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function MusicGenreConfig({ data, onUpdate }: ConfigProps<MusicGenreData>) {
  const subgenres = useMemo(() => getMusicGenre(data.genre)?.subgenres ?? [], [data.genre])
  return (
    <div className="flex flex-col gap-3">
      {pickerRow("Genre", MUSIC_GENRES, data.genre, (v) => onUpdate({ genre: v, subgenre: undefined }))}
      {subgenres.length > 0 && pickerRow("Subgenre", subgenres, data.subgenre, (v) => onUpdate({ subgenre: v }))}
      {pickerRow("Era", MUSIC_ERAS, data.era, (v) => onUpdate({ era: v }))}
    </div>
  )
}

export function MusicMoodConfig({ data, onUpdate }: ConfigProps<MusicMoodData>) {
  return (
    <div className="flex flex-col gap-3">
      {pickerRow("Energy", MUSIC_ENERGIES, data.energy, (v) => onUpdate({ energy: v }))}
      {pickerRow("Emotion", MUSIC_EMOTIONS, data.emotion, (v) => onUpdate({ emotion: v }))}
      {pickerRow("Vibe", MUSIC_VIBES, data.vibe, (v) => onUpdate({ vibe: v }))}
    </div>
  )
}

export function InstrumentationConfig({ data, onUpdate }: ConfigProps<InstrumentationData>) {
  // Always operate in multi mode for instruments. Default is an empty array
  // (see INSTRUMENTATION_DEFAULT_DATA) so `useMultiPick` treats it as multi.
  const value: MultiPickValue = data.instruments ?? []
  const { selectedIds, handlePick } = useMultiPick(
    value,
    (next) => {
      const arr = Array.isArray(next) ? [...next] : next ? [next] : []
      onUpdate({ instruments: arr })
    },
    INSTRUMENTS.length,
  )
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label className="text-xs">Instruments</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {INSTRUMENTS.map((i) => {
            const selected = selectedIds.includes(i.id)
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => handlePick(i.id)}
                className={`px-2 py-0.5 text-[11px] rounded-md border ${selected ? "bg-[#ff0073] text-white border-[#ff0073]" : "bg-muted text-foreground border-border"}`}
              >{i.label}</button>
            )
          })}
        </div>
      </div>
      {pickerRow("Production", PRODUCTION_STYLES, data.production, (v) => onUpdate({ production: v }))}
      {pickerRow("Vocal Presence", VOCAL_PRESENCE, data.vocalPresence, (v) => onUpdate({ vocalPresence: v }))}
    </div>
  )
}

export function VoiceCharacterConfig({ data, onUpdate }: ConfigProps<VoiceCharacterData>) {
  return (
    <div className="flex flex-col gap-3">
      {pickerRow("Age", VOICE_AGES, data.age, (v) => onUpdate({ age: v }))}
      {pickerRow("Gender", VOICE_GENDERS, data.gender, (v) => onUpdate({ gender: v }))}
      {pickerRow("Accent", VOICE_ACCENTS, data.accent, (v) => onUpdate({ accent: v }))}
      {pickerRow("Timbre", VOICE_TIMBRES, data.timbre, (v) => onUpdate({ timbre: v }))}
    </div>
  )
}

export function VoiceDeliveryConfig({ data, onUpdate }: ConfigProps<VoiceDeliveryData>) {
  return (
    <div className="flex flex-col gap-3">
      {pickerRow("Pace", VOICE_PACES, data.pace, (v) => onUpdate({ pace: v }))}
      {pickerRow("Emotion", VOICE_EMOTIONS, data.emotion, (v) => onUpdate({ emotion: v }))}
      {pickerRow("Archetype", VOICE_ARCHETYPES, data.archetype, (v) => onUpdate({ archetype: v }))}
    </div>
  )
}
