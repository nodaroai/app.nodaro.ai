// The video model every run of the trend uses: Seedance 2.5 (the default, and
// every trend saved before the choice) or Kling 4. People running the trend
// never choose it; the trend's page offers the resolutions it renders. A draft
// that names none keeps no `engine`, so loading one is no change; choosing
// Seedance 2.5 on it writes the choice.
//
// Kling 4 renders whole seconds, so it also has a Length: which end of the clip
// a run cuts to whole seconds (the end, the default, or the start). Shown, and
// saved, only while the model is Kling 4. Likewise its Pulse audio: the
// original audio back on the result (the default) or Kling's own track.
//
// Prism has its reference audio instead: what the reference video sent to the
// video model carries, per output resolution (the full audio, the default; the
// voice only; or none). Shown, and saved, only while the model is Prism.

import { useId } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AdminTrendEngine, AdminTrendKlingLength, CastSwapPrismReferenceAudioByResolution, CastSwapPulseAudioId } from "@/lib/api"
import { engineOfForm } from "../model"
import { PulseAudioSelect } from "./PulseAudioSelect"
import { PrismReferenceAudioSelect } from "./PrismReferenceAudioSelect"

const ENGINES: ReadonlyArray<{ value: AdminTrendEngine; label: string; hint: string }> = [
  {
    value: "seedance-2-5",
    label: "Nodaro Motion Prism (Seedance 2.5, default)",
    hint: "Edits the clip itself. Runs at 480p (a draft), 720p or 1080p; Full Quality redoes a draft's own take at 1080p.",
  },
  {
    value: "kling-4",
    label: "Nodaro Motion Pulse (Kling 4)",
    hint: "Makes a new take guided by the clip and the pictures. Runs at 720p or 1080p, with no draft; Full Quality makes a new take at 1080p.",
  },
]

const LENGTHS: ReadonlyArray<{ value: AdminTrendKlingLength; label: string }> = [
  { value: "cut-end", label: "Cut the end to whole seconds" },
  { value: "cut-start", label: "Cut the start to whole seconds" },
]

const DEFAULT_LENGTH: AdminTrendKlingLength = "cut-end"

interface Props {
  /** As stored; undefined = the draft names none (Seedance 2.5). */
  readonly value: AdminTrendEngine | undefined
  /** As stored; undefined = none set (cut the end). */
  readonly klingLength: AdminTrendKlingLength | undefined
  /** As stored; undefined = none set (the original audio). */
  readonly pulseAudio: CastSwapPulseAudioId | undefined
  /** Per output resolution; undefined (or a resolution left out) = the full audio. */
  readonly prismReferenceAudio: CastSwapPrismReferenceAudioByResolution | undefined
  readonly onChange: (next: AdminTrendEngine) => void
  readonly onKlingLengthChange: (next: AdminTrendKlingLength) => void
  readonly onPulseAudioChange: (next: CastSwapPulseAudioId) => void
  readonly onPrismReferenceAudioChange: (next: CastSwapPrismReferenceAudioByResolution) => void
}

export function EngineEditor({
  value,
  klingLength,
  pulseAudio,
  prismReferenceAudio,
  onChange,
  onKlingLengthChange,
  onPulseAudioChange,
  onPrismReferenceAudioChange,
}: Props) {
  const engine = engineOfForm({ engine: value })
  const hint = ENGINES.find((e) => e.value === engine)?.hint
  const id = useId()
  const selectId = `${id}-engine`
  const hintId = `${id}-hint`
  const lengthId = `${id}-length`

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={selectId} className="font-medium">
            Model
          </label>
          <Select value={engine} onValueChange={(e) => onChange(e as AdminTrendEngine)}>
            <SelectTrigger id={selectId} className="h-9" aria-describedby={hintId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENGINES.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {engine === "kling-4" && (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={lengthId} className="font-medium">
              Length
            </label>
            <Select value={klingLength ?? DEFAULT_LENGTH} onValueChange={(l) => onKlingLengthChange(l as AdminTrendKlingLength)}>
              <SelectTrigger id={lengthId} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LENGTHS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {engine === "kling-4" && <PulseAudioSelect value={pulseAudio} onChange={onPulseAudioChange} />}
        {engine === "seedance-2-5" && <PrismReferenceAudioSelect value={prismReferenceAudio} onChange={onPrismReferenceAudioChange} />}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  )
}
