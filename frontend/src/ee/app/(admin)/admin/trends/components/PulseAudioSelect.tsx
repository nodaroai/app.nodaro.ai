// What sound a Nodaro Motion Pulse (Kling 4) run delivers: the original audio
// back on the result, exactly (the default), or Kling's own track as is. The
// trend editor shows it beside the Length while the model is Pulse; Admin →
// Nodaro Motion shows it in the Pulse engine's section, for direct runs.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CastSwapPulseAudioId } from "@/lib/api"

export const PULSE_AUDIO_OPTIONS: ReadonlyArray<{ value: CastSwapPulseAudioId; label: string; hint: string }> = [
  { value: "original", label: "Original audio (default)", hint: "The original audio goes back on the result, exactly" },
  { value: "generated", label: "Kling's audio", hint: "Kling keeps the clip's sound and its own track is delivered as is" },
]

export const DEFAULT_PULSE_AUDIO: CastSwapPulseAudioId = "original"

interface Props {
  /** As stored; undefined (or null) = none set (the original audio). */
  readonly value: CastSwapPulseAudioId | null | undefined
  readonly onChange: (next: CastSwapPulseAudioId) => void
  readonly label?: string
  /** Said under the hint (e.g. that this environment's engine does not take it yet). */
  readonly note?: string
}

export function PulseAudioSelect({ value, onChange, label = "Pulse audio", note }: Props) {
  const id = useId()
  const selectId = `${id}-pulse-audio`
  const hintId = `${id}-pulse-audio-hint`
  const current = value ?? DEFAULT_PULSE_AUDIO
  const hint = PULSE_AUDIO_OPTIONS.find((o) => o.value === current)?.hint

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={selectId} className="font-medium">
        {label}
      </label>
      <Select value={current} onValueChange={(v) => onChange(v as CastSwapPulseAudioId)}>
        <SelectTrigger id={selectId} className="h-9" aria-describedby={hintId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PULSE_AUDIO_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
        {note ? ` ${note}` : ""}
      </p>
    </div>
  )
}
