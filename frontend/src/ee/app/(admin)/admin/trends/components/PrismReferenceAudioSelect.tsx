// What audio the reference video a Nodaro Motion Prism run sends to the video
// model carries: the clip's full audio (the default), only the voice split
// from the music, or none. The original audio always goes back on the result.
// The trend editor shows it beside the Model while the model is Prism; Admin →
// Nodaro Motion shows it in the Prism engine's section, for direct runs.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CastSwapPrismReferenceAudioId } from "@/lib/api"

export const PRISM_REFERENCE_AUDIO_OPTIONS: ReadonlyArray<{ value: CastSwapPrismReferenceAudioId; label: string }> = [
  { value: "full", label: "Full audio (default)" },
  { value: "voice", label: "Voice only (music removed)" },
  { value: "none", label: "No audio" },
]

export const DEFAULT_PRISM_REFERENCE_AUDIO: CastSwapPrismReferenceAudioId = "full"

export const PRISM_REFERENCE_AUDIO_HINT =
  "What the engine hears in the reference video. The original audio always goes back on the result."

interface Props {
  /** As stored; undefined (or null) = none set (the full audio). */
  readonly value: CastSwapPrismReferenceAudioId | null | undefined
  readonly onChange: (next: CastSwapPrismReferenceAudioId) => void
  readonly label?: string
  /** Said under the hint (e.g. that this environment's engine does not take it yet). */
  readonly note?: string
}

export function PrismReferenceAudioSelect({ value, onChange, label = "Prism reference audio", note }: Props) {
  const id = useId()
  const selectId = `${id}-prism-reference-audio`
  const hintId = `${id}-prism-reference-audio-hint`
  const current = value ?? DEFAULT_PRISM_REFERENCE_AUDIO

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={selectId} className="font-medium">
        {label}
      </label>
      <Select value={current} onValueChange={(v) => onChange(v as CastSwapPrismReferenceAudioId)}>
        <SelectTrigger id={selectId} className="h-9" aria-describedby={hintId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRISM_REFERENCE_AUDIO_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={hintId} className="text-xs text-muted-foreground">
        {PRISM_REFERENCE_AUDIO_HINT}
        {note ? ` ${note}` : ""}
      </p>
    </div>
  )
}
