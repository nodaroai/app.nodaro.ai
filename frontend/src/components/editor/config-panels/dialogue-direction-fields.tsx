"use client"

import { useId } from "react"
import { dialogueOutputFormatFor, dialogueOutputFormats, type TtsOutputFormat } from "@nodaro/shared/models"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n"
import { upsertDialogueSpeaker } from "@/lib/dialogue-direction"
import type { DialogueSpeakerDirection } from "@/types/nodes"
import { TtsNamedVoiceSelect } from "./tts-named-voice-select"
import { TtsDirectionSection } from "./tts-direction-section"
import { SpeechFileFormatSelect } from "./speech-file-format-select"

/**
 * The Text to Dialogue panel's parts for a model with named voices and a
 * direction of its own (Gemini, decided 2026-11-12) — each drawn from the
 * model's sheet by the panel, never from a model id. They write only in the
 * person's own handlers, never from an effect.
 */

/** A line's voice on a model with named voices: the model's list (the text-to-speech panel's control), showing the voice the run sends. */
export function DialogueLineVoiceSelect({ provider, voice, n, onPick, cloneLabels }: {
  /** The model the panel shows. */
  readonly provider: string
  /** The voice the run sends for this line (`dialogueVoicesForModel`), never the stored one when it moves. */
  readonly voice: string
  /** The line's number, from 1. */
  readonly n: number
  readonly onPick: (voice: string) => void
  /** The node's cloned voices (Gemini 3.8 Flash), offered beside the model's own. */
  readonly cloneLabels?: readonly string[]
}) {
  const t = useT()
  const labelId = useId()
  const clones = cloneLabels && cloneLabels.length > 0 ? { heading: t("audiocfg.clonesTitle"), labels: cloneLabels } : undefined
  return (
    <div className="flex-1 min-w-0">
      <span id={labelId} className="sr-only">{t("audiocfg.dialogueLineVoice", { n })}</span>
      <TtsNamedVoiceSelect provider={provider} voiceId={voice} labelledBy={labelId} onUpdate={(pick) => onPick(pick.voiceId)} clones={clones} />
    </div>
  )
}

/** A line's free-text style (Gemini 3.8), up to the model's cap. Never spoken, never billed. */
export function DialogueLineStyleInput({ max, value, n, onChange }: {
  readonly max: number
  readonly value: string
  readonly n: number
  readonly onChange: (value: string) => void
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-2" data-testid="dialogue-line-style">
      <Input
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("audiocfg.directionStylePh")}
        aria-label={t("audiocfg.dialogueLineStyle", { n })}
        className="h-7 text-xs"
        dir="auto"
      />
      <span className={`text-[11px] shrink-0 ${value.length > max ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>
        {value.length}/{max}
      </span>
    </div>
  )
}

/**
 * One block per speaker (each distinct voice of the script, in line order),
 * each the text-to-speech panel's direction controls for that voice (Gemini
 * 3.1 / 2.5: style, pace, accent, audio profile). A choice's "Default" and an
 * emptied text clear the field; a speaker with nothing set has no entry.
 */
export function DialogueSpeakersSection({ provider, voices, speakers, onUpdate }: {
  readonly provider: string
  /** The script's distinct voices as the run sends them. */
  readonly voices: readonly string[]
  readonly speakers: readonly DialogueSpeakerDirection[] | undefined
  readonly onUpdate: (patch: { speakers: DialogueSpeakerDirection[] | undefined }) => void
}) {
  const t = useT()
  if (voices.length === 0) return null
  return (
    <>
      <Separator />
      <div className="space-y-2" data-testid="dialogue-speakers">
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{t("audiocfg.dialogueSpeakersTitle")}</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("audiocfg.dialogueSpeakersHint")}</p>
        </div>
        {voices.map((voice) => {
          const entry = speakers?.find((s) => s?.voice === voice)
          return (
            <section key={voice} className="rounded-md border border-border p-2 space-y-2" aria-label={t("audiocfg.dialogueSpeakerTitle", { voice })}>
              <p className="text-xs font-medium">{t("audiocfg.dialogueSpeakerTitle", { voice })}</p>
              <TtsDirectionSection
                provider={provider}
                data={entry ?? {}}
                onUpdate={(patch) => onUpdate({ speakers: upsertDialogueSpeaker(speakers, voice, patch) })}
              />
            </section>
          )
        })}
      </div>
    </>
  )
}

/** "Filler words" (Gemini 3.8, exactly two speakers): the model may add natural filler words between them. */
export function DialogueFillerWordsSwitch({ checked, onChange }: {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  const t = useT()
  const id = useId()
  return (
    <div data-testid="dialogue-filler-words">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{t("audiocfg.dialogueFillerWords")}</Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{t("audiocfg.dialogueFillerWordsHint")}</p>
    </div>
  )
}

/** Each file format's name in every language. Typed by the format union, so a format added without a label fails tsc. */
/**
 * The Text to Dialogue file: the speech file select on the formats the model
 * delivers (`dialogueOutputFormats`), drawn only when it delivers more than one
 * (an ElevenLabs dialogue model: the default MP3 only).
 */
export function DialogueFileFormatSelect({ provider, value, onChange }: {
  readonly provider: string
  readonly value: unknown
  readonly onChange: (format: TtsOutputFormat | undefined) => void
}) {
  const formats = dialogueOutputFormats(provider)
  if (formats.length < 2) return null
  return (
    <SpeechFileFormatSelect
      formats={formats}
      value={dialogueOutputFormatFor(provider, value)}
      onChange={onChange}
      testId="dialogue-file-format"
    />
  )
}
