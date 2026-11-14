"use client"

import { useId } from "react"
import { DEFAULT_TTS_OUTPUT_FORMAT, type TtsOutputFormat } from "@nodaro/shared/models"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"

/** Each speech file's label: a new format without one fails tsc. */
const OUTPUT_FORMAT_LABEL_KEYS: Record<TtsOutputFormat, MessageKey> = {
  mp3_44100_128: "audiocfg.fileFormatMp3_128",
  mp3_44100_192: "audiocfg.fileFormatMp3_192",
  wav_24000: "audiocfg.fileFormatWav24",
}

/**
 * The speech file a node delivers (decided 2026-11-13): MP3 at 128 kbps (the
 * default) or 192 kbps, or WAV — the Text to Speech and Text to Dialogue
 * panels' one control. It shows the default for a node with none and writes
 * only on the person's pick; picking the default clears the field, so a node
 * on the default stores nothing.
 */
export function SpeechFileFormatSelect({ formats, value, onChange, testId }: {
  /** The formats offered, in order. */
  readonly formats: readonly TtsOutputFormat[]
  /** The node's format, when it is one offered; else the default is shown. */
  readonly value: TtsOutputFormat | undefined
  readonly onChange: (format: TtsOutputFormat | undefined) => void
  readonly testId: string
}) {
  const t = useT()
  const labelId = useId()
  const shown = value ?? DEFAULT_TTS_OUTPUT_FORMAT
  return (
    <div data-testid={testId}>
      <Label id={labelId}>{t("audiocfg.fileFormat")}</Label>
      <Select
        value={shown}
        onValueChange={(v) => {
          // Radix can report "" while its items change: no choice was made.
          if (!v) return
          onChange(v === DEFAULT_TTS_OUTPUT_FORMAT ? undefined : (v as TtsOutputFormat))
        }}
      >
        <SelectTrigger aria-labelledby={labelId}><SelectValue /></SelectTrigger>
        <SelectContent>
          {formats.map((f) => (
            <SelectItem key={f} value={f}>{t(OUTPUT_FORMAT_LABEL_KEYS[f])}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
