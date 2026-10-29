// What audio the reference video a Nodaro Motion Prism run sends to the video
// model carries, per output resolution: the clip's full audio (the default),
// only the voice split from the music, or none. The original audio always goes
// back on the result. The trend editor shows it beside the Model while the
// model is Prism; Admin → Nodaro Motion shows it in the Prism engine's
// section, for direct runs.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CastSwapPrismReferenceAudioByResolution, CastSwapPrismReferenceAudioId } from "@/lib/api"
import { PRISM_RESOLUTIONS, prismReferenceAudioTriple } from "../prism-reference-audio"

export const PRISM_REFERENCE_AUDIO_OPTIONS: ReadonlyArray<{ value: CastSwapPrismReferenceAudioId; label: string }> = [
  { value: "full", label: "Full audio" },
  { value: "voice", label: "Voice only" },
  { value: "none", label: "No audio" },
]

export const PRISM_REFERENCE_AUDIO_HINT =
  "What the engine hears in the reference video, per output resolution. The original audio always goes back on the result."

interface Props {
  /** As stored (a plain mode from earlier = that mode at every resolution); undefined (or null) = none set (the full audio). */
  readonly value: CastSwapPrismReferenceAudioByResolution | CastSwapPrismReferenceAudioId | null | undefined
  /** Every resolution's mode, the one changed included. */
  readonly onChange: (next: CastSwapPrismReferenceAudioByResolution) => void
  readonly label?: string
  /** Said under the hint (e.g. that this environment's engine does not take it yet). */
  readonly note?: string
}

export function PrismReferenceAudioSelect({ value, onChange, label = "Prism reference audio", note }: Props) {
  const id = useId()
  const hintId = `${id}-prism-reference-audio-hint`
  const current = prismReferenceAudioTriple(value)

  return (
    <div role="group" aria-label={label} aria-describedby={hintId} className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {PRISM_RESOLUTIONS.map((resolution) => {
          const selectId = `${id}-prism-reference-audio-${resolution}`
          return (
            <div key={resolution} className="flex min-w-0 flex-col gap-0.5">
              <label htmlFor={selectId} className="text-xs text-muted-foreground">
                {resolution}
              </label>
              <Select
                value={current[resolution]}
                onValueChange={(v) => onChange({ ...current, [resolution]: v as CastSwapPrismReferenceAudioId })}
              >
                <SelectTrigger id={selectId} className="h-9 min-w-0">
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
            </div>
          )
        })}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {PRISM_REFERENCE_AUDIO_HINT}
        {note ? ` ${note}` : ""}
      </p>
    </div>
  )
}
