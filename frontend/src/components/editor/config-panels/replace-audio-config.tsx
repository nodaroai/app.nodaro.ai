"use client"

import {
  REPLACE_AUDIO_LEVERS,
  REPLACE_AUDIO_MODES,
  REPLACE_AUDIO_MUSIC_PROMPT_MAX,
  REPLACE_AUDIO_MUSIC_SOURCES,
  replaceAudioLever,
  replaceAudioMode,
  replaceAudioMusicSource,
  replaceAudioNodeCreditId,
  type ReplaceAudioLever,
  type ReplaceAudioMode,
  type ReplaceAudioMusicSource,
} from "@nodaro/render-rules"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { creditUnitLabel, creditUnits } from "@/lib/credit-units"
import { hasCredits } from "@/lib/edition"
import { useT, type MessageKey } from "@/lib/i18n"
import type { ReplaceAudioNodeData } from "@/types/nodes"

/** Option captions, keyed by the shared enums — a new value fails tsc here. */
export const REPLACE_AUDIO_MODE_LABEL_KEYS: Readonly<Record<ReplaceAudioMode, MessageKey>> = {
  "keep-speech": "replaceAudio.modeKeepSpeech",
  "replace-all": "replaceAudio.modeReplaceAll",
}
const MODE_HINT_KEYS: Readonly<Record<ReplaceAudioMode, MessageKey>> = {
  "keep-speech": "replaceAudio.modeKeepSpeechHint",
  "replace-all": "replaceAudio.modeReplaceAllHint",
}
export const REPLACE_AUDIO_MUSIC_SOURCE_LABEL_KEYS: Readonly<Record<ReplaceAudioMusicSource, MessageKey>> = {
  input: "replaceAudio.musicFromInput",
  prompt: "replaceAudio.musicFromPrompt",
}
const LEVER_LABEL_KEYS: Readonly<Record<ReplaceAudioLever, MessageKey>> = {
  musicVolume: "replaceAudio.musicVolume",
  speechVolume: "replaceAudio.speechVolume",
  duckAmount: "replaceAudio.duckAmount",
}
const LEVER_HINT_KEYS: Readonly<Record<ReplaceAudioLever, MessageKey>> = {
  musicVolume: "replaceAudio.musicVolumeHint",
  speechVolume: "replaceAudio.speechVolumeHint",
  duckAmount: "replaceAudio.duckAmountHint",
}

/** The levers a mode offers: the speech's two only while the speech is kept. */
export function replaceAudioLeversFor(mode: ReplaceAudioMode): readonly ReplaceAudioLever[] {
  return mode === "keep-speech" ? ["musicVolume", "speechVolume", "duckAmount"] : ["musicVolume"]
}

function LeverSlider({ name, value, onChange }: { readonly name: ReplaceAudioLever; readonly value: number; readonly onChange: (n: number) => void }) {
  const t = useT()
  const bounds = REPLACE_AUDIO_LEVERS[name]
  const id = `replace-audio-${name}`
  return (
    <div>
      <Label htmlFor={id}>{t(LEVER_LABEL_KEYS[name], { n: value })}</Label>
      <input
        id={id}
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={value}
        onChange={(e) => onChange(replaceAudioLever(name, parseInt(e.target.value, 10)))}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
      />
      <p className="text-[11px] text-muted-foreground mt-1">{t(LEVER_HINT_KEYS[name])}</p>
    </div>
  )
}

/**
 * Replace Audio settings. Values are read through the shared readers
 * (`@nodaro/render-rules` replace-audio.ts) the request body is built with, so a
 * node written straight into workflow JSON shows what it will send. The run is
 * served on Nodaro Cloud; the price is the row its settings quote
 * (`replaceAudioNodeCreditId`), as on the Run button.
 */
export function ReplaceAudioConfig({ data, onUpdate }: { data: ReplaceAudioNodeData; onUpdate: (patch: Partial<ReplaceAudioNodeData>) => void }) {
  const t = useT()
  const mode = replaceAudioMode(data.mode)
  const musicSource = replaceAudioMusicSource(data.musicSource)
  const prompt = typeof data.musicPrompt === "string" ? data.musicPrompt : ""
  const promptLength = prompt.trim().length
  const promptTooLong = promptLength > REPLACE_AUDIO_MUSIC_PROMPT_MAX
  const credits = useModelCredits(replaceAudioNodeCreditId(data))

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">{t("replaceAudio.desc")}</p>

      <div>
        <Label>{t("replaceAudio.mode")}</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: replaceAudioMode(v) })}>
          <SelectTrigger aria-label={t("replaceAudio.mode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {REPLACE_AUDIO_MODES.map((m) => (
              <SelectItem key={m} value={m}>{t(REPLACE_AUDIO_MODE_LABEL_KEYS[m])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground mt-1">{t(MODE_HINT_KEYS[mode])}</p>
      </div>

      <div>
        <Label>{t("replaceAudio.music")}</Label>
        <Select value={musicSource} onValueChange={(v) => onUpdate({ musicSource: replaceAudioMusicSource(v) })}>
          <SelectTrigger aria-label={t("replaceAudio.music")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {REPLACE_AUDIO_MUSIC_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>{t(REPLACE_AUDIO_MUSIC_SOURCE_LABEL_KEYS[s])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {musicSource === "input" && <p className="text-[11px] text-muted-foreground mt-1">{t("replaceAudio.musicFromInputHint")}</p>}
      </div>

      {musicSource === "prompt" && (
        <div>
          <Label htmlFor="replace-audio-music-prompt">{t("replaceAudio.musicPrompt")}</Label>
          <Textarea
            id="replace-audio-music-prompt"
            value={prompt}
            placeholder={t("replaceAudio.musicPromptPlaceholder")}
            aria-invalid={promptTooLong || undefined}
            onChange={(e) => onUpdate({ musicPrompt: e.target.value })}
            className="min-h-20 text-sm"
          />
          <p
            data-testid="replace-audio-prompt-count"
            className={`text-[11px] mt-1 text-end ${promptTooLong ? "text-red-500" : "text-muted-foreground"}`}
          >
            {t("replaceAudio.promptCount", { n: promptLength, max: REPLACE_AUDIO_MUSIC_PROMPT_MAX })}
          </p>
        </div>
      )}

      {replaceAudioLeversFor(mode).map((name) => (
        <LeverSlider key={name} name={name} value={replaceAudioLever(name, data[name])} onChange={(n) => onUpdate({ [name]: n })} />
      ))}

      {hasCredits() && credits > 0 && (
        <p className="text-[11px] text-muted-foreground px-1" data-testid="replace-audio-price-line">
          {t("replaceAudio.priceLine", { credits: creditUnits(credits), unit: creditUnitLabel(t("credits.unitShort")) })}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground px-1">{t("replaceAudio.cloudNote")}</p>
    </div>
  )
}
