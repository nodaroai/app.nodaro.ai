// What audio the reference video a Nodaro Motion Prism run sends to the video
// model carries, per output resolution: the clip's full audio (the default),
// only the voice split from the music, none, the audio flattened to one tone,
// or raised one octave. The original audio always goes back on the result.
// One-tone and Octave are offered only where the engine lists them
// (`offered`): elsewhere they are shown greyed out, unless a resolution
// already has one (it stays, to be set to another mode). The trend editor shows it beside the Model while the
// model is Prism; Admin → Nodaro Motion shows it in the Prism engine's
// section, for direct runs.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CastSwapPrismReferenceAudioByResolution, CastSwapPrismReferenceAudioId } from "@/lib/api"
import { DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES, PRISM_RESOLUTIONS, prismReferenceAudioTriple } from "../prism-reference-audio"

export const PRISM_REFERENCE_AUDIO_OPTIONS: ReadonlyArray<{ value: CastSwapPrismReferenceAudioId; label: string; hint?: string }> = [
  { value: "full", label: "Full audio" },
  { value: "voice", label: "Voice only" },
  { value: "none", label: "No audio" },
  {
    value: "one-tone",
    label: "One-tone (flattened, no melody)",
    hint: "The clip's audio flattened to one steady tone: keeps the words' rhythm for lip sync without the melody. The original audio is put back on the result.",
  },
  {
    value: "octave",
    label: "Octave (+12, one octave up)",
    hint: "The clip's audio raised one octave: keeps the melody and the words for lip sync. The original audio is put back on the result.",
  },
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
  /**
   * The modes only some engines take (One-tone, Octave) that may be chosen
   * here: a trend's editor offers one some environment's engine lists, the
   * shared Nodaro Motion setting one every environment's engine lists. Left
   * out: none.
   */
  readonly offered?: readonly CastSwapPrismReferenceAudioId[]
  /** Said when a mode is not offered (e.g. which environments' engines cannot take it yet). */
  readonly unofferedNote?: string
}

export function PrismReferenceAudioSelect({ value, onChange, label = "Prism reference audio", note, offered = [], unofferedNote }: Props) {
  const id = useId()
  const hintId = `${id}-prism-reference-audio-hint`
  const current = prismReferenceAudioTriple(value)
  const isOffered = (mode: CastSwapPrismReferenceAudioId) => !DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES.includes(mode) || offered.includes(mode)
  const declaredOnly = PRISM_REFERENCE_AUDIO_OPTIONS.filter((o) => DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES.includes(o.value))
  const someUnoffered = declaredOnly.some((o) => !isOffered(o.value))

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
                    // A mode not offered stays choosable where it is already set (to be set to another).
                    <SelectItem key={o.value} value={o.value} disabled={!isOffered(o.value) && current[resolution] !== o.value}>
                      {o.label}
                      {isOffered(o.value) ? "" : " (not supported yet)"}
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
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {declaredOnly.map((o) => (
          <li key={o.value}>
            <span className="font-medium">{o.label}:</span> {o.hint}
          </li>
        ))}
      </ul>
      {someUnoffered && unofferedNote ? <p className="text-xs text-muted-foreground">{unofferedNote}</p> : null}
    </div>
  )
}
