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
//
// Either engine may run as its Flash choice (decided 2026-11-22): Prism Flash or
// Pulse Flash, the engine's run on the faster, lower-cost model of the same
// family (no 1080p, no draft, no Full Quality). A run of such a trend is refused
// while Admin, Video Remake does not offer that Flash choice.
//
// Pulse has its reference audio too, beside its Pulse audio: what the clip sent
// to the video model carries, per output resolution, a resolution left as it
// is following the Pulse audio chosen here. Shown, and saved, only while the
// model is Pulse.

import { useId } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AdminTrendEngine,
  AdminTrendKlingLength,
  CastSwapPrismReferenceAudioByResolution,
  CastSwapPulseAudioId,
  CastSwapPulseReferenceAudioByResolution,
  TrendEngineEnvironment,
} from "@/lib/api"
import { engineOfForm } from "../model"
import { PulseAudioSelect } from "./PulseAudioSelect"
import { PrismReferenceAudioSelect } from "./PrismReferenceAudioSelect"
import { PulseReferenceAudioSelect } from "./PulseReferenceAudioSelect"

const ENGINES: ReadonlyArray<{ value: AdminTrendEngine; label: string; hint: string }> = [
  {
    value: "seedance-2-5",
    label: "Nodaro Prism (Seedance 2.5, default)",
    hint: "Edits the clip itself. Runs at 480p, 720p or 1080p; a 480p draft (\"1080p, preview first\") can be finished as the same take at 1080p with Full Quality.",
  },
  {
    value: "kling-4",
    label: "Nodaro Pulse (Kling 4)",
    hint: "Makes a new take guided by the clip and the pictures. Runs at 720p or 1080p, with no draft and no Full Quality.",
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
  /** Per output resolution, only those off the default of `pulseAudio`; undefined = none (each follows the Pulse audio). */
  readonly pulseReferenceAudio: CastSwapPulseReferenceAudioByResolution | undefined
  readonly onChange: (next: AdminTrendEngine) => void
  /** Whether the trend runs on its engine's Flash choice (absent: not offered here, no control). */
  readonly flash?: boolean
  readonly onFlashChange?: (on: boolean) => void
  readonly onKlingLengthChange: (next: AdminTrendKlingLength) => void
  readonly onPulseAudioChange: (next: CastSwapPulseAudioId) => void
  readonly onPrismReferenceAudioChange: (next: CastSwapPrismReferenceAudioByResolution) => void
  readonly onPulseReferenceAudioChange: (next: CastSwapPulseReferenceAudioByResolution) => void
  /** Each environment's engine and platform, as reported: the reference audio only some take is offered once every one does. */
  readonly envs?: readonly TrendEngineEnvironment[]
  /** The environments could not be read: said in words, naming none. */
  readonly envsUnreadable?: boolean
}

export function EngineEditor({
  value,
  klingLength,
  pulseAudio,
  prismReferenceAudio,
  pulseReferenceAudio,
  onChange,
  flash,
  onFlashChange,
  onKlingLengthChange,
  onPulseAudioChange,
  onPrismReferenceAudioChange,
  onPulseReferenceAudioChange,
  envs,
  envsUnreadable,
}: Props) {
  const engine = engineOfForm({ engine: value })
  const hint = ENGINES.find((e) => e.value === engine)?.hint
  const id = useId()
  const selectId = `${id}-engine`
  const hintId = `${id}-hint`
  const lengthId = `${id}-length`
  const flashId = `${id}-flash`

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        {onFlashChange && (
          <div className="flex items-center gap-2 text-sm sm:col-span-2">
            <input id={flashId} type="checkbox" className="h-4 w-4" checked={flash === true} onChange={(e) => onFlashChange(e.target.checked)} />
            <label htmlFor={flashId}>
              Run on {engine === "kling-4" ? "Pulse Flash" : "Prism Flash"} (the faster, lower-cost model; no 1080p, draft or Full Quality; refused while Admin, Video Remake does not offer it)
            </label>
          </div>
        )}
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
        {engine === "kling-4" && (
          <div className="sm:col-span-2">
            <PulseReferenceAudioSelect
              value={pulseReferenceAudio}
              out={pulseAudio}
              onChange={onPulseReferenceAudioChange}
              envs={envs}
              envsUnreadable={envsUnreadable}
              sharedBy="trend"
            />
          </div>
        )}
        {engine === "seedance-2-5" && (
          <div className="sm:col-span-2">
            <PrismReferenceAudioSelect
              value={prismReferenceAudio}
              onChange={onPrismReferenceAudioChange}
              envs={envs}
              envsUnreadable={envsUnreadable}
              sharedBy="trend"
            />
          </div>
        )}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  )
}
