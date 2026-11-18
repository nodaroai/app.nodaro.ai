// What audio the clip a Nodaro Pulse (Kling 4) run sends to the video model
// carries ("audio in"), per output resolution: Prism's modes (no audio, the
// clip's whole mix, only the vocals, or either flattened to one steady tone)
// and its pitch shift in semitones (-24 to 24 in steps of 0.5; 0 = none; none
// for No audio). What the result carries stays the Pulse audio's choice
// ("audio out", beside it), in any combination.
//
// A resolution left as it is follows the Pulse audio shown beside it (`out`,
// decided 2026-11-18): the full mix at +4 with the original audio, at 0 with
// Kling's audio, and it is re-read when that changes. A resolution set back to
// that default is left out again. Every environment shares one database, so a
// value off the default is offered once EVERY environment's engine declares
// `castSwap.pulseReferenceAudio` and its platform claims it, each named apart
// while one is missing (`envs`). Until then only the default is offered, a
// value already set staying, to be set back. The trend editor shows it under
// the Model while the model is Pulse; Admin → Video Remake shows it in the
// Pulse engine's section, for direct runs.

import { useId, useState } from "react"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CastSwapPrismReferenceAudioMode, CastSwapPulseAudioId, CastSwapPulseReferenceAudioByResolution, CastSwapPulseResolution, TrendEngineEnvironment } from "@/lib/api"
import { PRISM_REFERENCE_AUDIO_MODES, PRISM_REFERENCE_AUDIO_MODE_LABELS, PRISM_REFERENCE_AUDIO_SEMITONES } from "../prism-reference-audio"
import {
  PULSE_RESOLUTIONS,
  pulseReferenceAudioDefault,
  pulseReferenceAudioIsDefault,
  pulseReferenceAudioMissing,
  pulseReferenceAudioOf,
  pulseReferenceAudioOfferedEverywhere,
  pulseReferenceAudioPair,
  pulseReferenceAudioStoredOf,
  pulseReferenceAudioSwitchMode,
  type PulseReferenceAudioFormValue,
} from "../pulse-reference-audio"
import { PRISM_REFERENCE_AUDIO_MODE_HINTS, PRISM_REFERENCE_AUDIO_PITCH_HINT, PRISM_REFERENCE_AUDIO_PITCH_LABEL } from "./PrismReferenceAudioSelect"

export const PULSE_REFERENCE_AUDIO_HINT =
  "What the engine hears in the clip it is sent, per output resolution. Left as it is, it follows the Pulse audio: the full mix at +4 with the original audio, at 0 with Kling's audio. What the result carries is the Pulse audio's choice."

/** Why every environment must take it. */
const SHARED_BY = { setting: "this setting is shared by every environment", trend: "trends are shared by every environment" } as const

/** Said in place of what each environment lacks when nothing can be said of them: fail-closed, and it names none. */
const ENVS_UNREADABLE = "The environments could not be read, so the Pulse reference audio can't be changed from its default yet. Reload the page to try again."

/** The same column widths as Prism's rows: the resolution, the select with the room left, then the field. Below 640 px each row is a stack. */
const ROW_COLUMNS = "sm:grid sm:grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] sm:gap-x-2"

interface Props {
  /** As stored: only the resolutions off the default; undefined (or null) = none set (each follows `out`). */
  readonly value: CastSwapPulseReferenceAudioByResolution | null | undefined
  /** The Pulse audio shown beside it (the draft's): what a resolution left out follows. Undefined = the original audio. */
  readonly out: CastSwapPulseAudioId | null | undefined
  /** The resolutions off the default of `out` (a resolution set back to it left out). */
  readonly onChange: (next: CastSwapPulseReferenceAudioByResolution) => void
  readonly label?: string
  /** Said under the hint (e.g. that this environment's engine does not take it yet). */
  readonly note?: string
  /** Each environment's engine and platform, as reported: a value off the default is offered once every one takes it, each missing one named. */
  readonly envs?: readonly TrendEngineEnvironment[]
  /** The environments could not be read: said in words, naming none (nothing is said while they are only loading). */
  readonly envsUnreadable?: boolean
  /** What the reasons say is shared by every environment: Admin → Video Remake's setting (the default), or a trend. */
  readonly sharedBy?: keyof typeof SHARED_BY
}

export function PulseReferenceAudioSelect({ value, out, onChange, label = "Pulse reference audio", note, envs, envsUnreadable = false, sharedBy = "setting" }: Props) {
  const id = useId()
  const hintId = `${id}-pulse-reference-audio-hint`
  const pitchHintId = `${id}-pulse-reference-audio-pitch-hint`
  const current = pulseReferenceAudioPair(value, out)
  const fallback = pulseReferenceAudioDefault(out)
  // The resolutions whose pitch shift the admin typed here: a mode switch keeps it.
  const [own, setOwn] = useState<ReadonlySet<CastSwapPulseResolution>>(() => new Set())
  const markOwn = (resolution: CastSwapPulseResolution) => setOwn((s) => (s.has(resolution) ? s : new Set(s).add(resolution)))
  const set = (resolution: CastSwapPulseResolution, next: PulseReferenceAudioFormValue) => {
    const stored = pulseReferenceAudioStoredOf(next)
    const rest = { ...pulseReferenceAudioOf(value) }
    // Set back to the default of the Pulse audio shown: left out, so it follows that again.
    if (pulseReferenceAudioIsDefault(stored, out)) delete rest[resolution]
    else rest[resolution] = stored
    onChange(Object.fromEntries(PULSE_RESOLUTIONS.filter((r) => rest[r]).map((r) => [r, rest[r]])))
  }
  const offered = pulseReferenceAudioOfferedEverywhere(envs)
  const missing = pulseReferenceAudioMissing(envs)
  const switchMode = (resolution: CastSwapPulseResolution, mode: CastSwapPrismReferenceAudioMode) => {
    const next = pulseReferenceAudioSwitchMode(current[resolution], mode, own.has(resolution), out)
    if (next.own) markOwn(resolution)
    set(resolution, next.value)
  }
  // A mode other than the default's waits for every environment; nothing is said of it while they are unknown.
  const modeOffered = (mode: CastSwapPrismReferenceAudioMode) => offered || mode === fallback.mode
  const modeName = (mode: CastSwapPrismReferenceAudioMode) => `${PRISM_REFERENCE_AUDIO_MODE_LABELS[mode]}${modeOffered(mode) || !envs ? "" : " (not supported yet)"}`
  const shared = SHARED_BY[sharedBy]
  const reasons = missing
    ? [
        ...(missing.engine.length > 0 ? [`The Cast Swap engine of ${missing.engine.join(", ")} cannot take the Pulse reference audio yet, and ${shared}.`] : []),
        ...(missing.platform.length > 0 ? [`The platform in ${missing.platform.join(", ")} does not take the Pulse reference audio yet, and ${shared}.`] : []),
      ]
    : envsUnreadable
      ? [ENVS_UNREADABLE]
      : []
  const { min, max, step } = PRISM_REFERENCE_AUDIO_SEMITONES

  return (
    <div role="group" aria-label={label} aria-describedby={hintId} className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {/* The pitch shift's name once, over its column, for the eye: each field keeps its own label, shown while they stack. */}
      <div aria-hidden="true" className={`hidden items-end text-xs text-muted-foreground ${ROW_COLUMNS}`}>
        <span className="sm:col-start-3">{PRISM_REFERENCE_AUDIO_PITCH_LABEL}</span>
      </div>
      <div className="flex flex-col gap-3 sm:gap-2">
        {PULSE_RESOLUTIONS.map((resolution) => {
          const selectId = `${id}-pulse-reference-audio-${resolution}`
          const pitchId = `${selectId}-pitch`
          const cur = current[resolution]
          const silent = cur.mode === "none"
          // Greyed out until every environment takes a value off the default; one already off it stays, to be set back.
          const pitchClosed = !offered && pulseReferenceAudioIsDefault(pulseReferenceAudioStoredOf(cur), out)
          return (
            <div key={resolution} role="group" aria-label={resolution} className={`flex min-w-0 flex-col gap-0.5 sm:items-center ${ROW_COLUMNS}`}>
              <label htmlFor={selectId} className="text-xs text-muted-foreground">
                {resolution}
              </label>
              <Select value={cur.mode} onValueChange={(mode) => switchMode(resolution, mode as CastSwapPrismReferenceAudioMode)}>
                <SelectTrigger id={selectId} className="min-h-11 w-full min-w-0 sm:min-h-0">
                  {/* As the list names it; where the select is too narrow, it ends in an ellipsis, the chevron still in view. */}
                  <SelectValue>
                    <span className="min-w-0 truncate">{modeName(cur.mode)}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRISM_REFERENCE_AUDIO_MODES.map((mode) => (
                    // A mode not offered stays choosable where it is already set (to be set to another).
                    <SelectItem key={mode} value={mode} disabled={!modeOffered(mode) && cur.mode !== mode} className="min-h-11 sm:min-h-0">
                      {modeName(mode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label htmlFor={pitchId} className="mt-1 text-xs text-muted-foreground sm:sr-only">
                {PRISM_REFERENCE_AUDIO_PITCH_LABEL}
              </label>
              <ClampedNumberInput
                id={pitchId}
                className="h-11 sm:h-9"
                // A minus sign: an iPhone's decimal pad has none, and the shift goes down to -24.
                inputMode="text"
                // No audio has no pitch shift: the field is empty and off.
                value={silent ? undefined : cur.semitones}
                min={min}
                max={max}
                step={step}
                snapToStep
                disabled={silent || pitchClosed}
                aria-describedby={pitchHintId}
                onCommit={(semitones) => {
                  if (semitones === undefined) return
                  markOwn(resolution)
                  set(resolution, { ...cur, semitones })
                }}
              />
            </div>
          )
        })}
      </div>
      <p id={pitchHintId} className="text-xs text-muted-foreground">
        {PRISM_REFERENCE_AUDIO_PITCH_HINT}
      </p>
      <p id={hintId} className="text-xs text-muted-foreground">
        {PULSE_REFERENCE_AUDIO_HINT}
        {note ? ` ${note}` : ""}
      </p>
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {PRISM_REFERENCE_AUDIO_MODES.filter((m) => PRISM_REFERENCE_AUDIO_MODE_HINTS[m]).map((m) => (
          <li key={m}>
            <span className="font-medium">{PRISM_REFERENCE_AUDIO_MODE_LABELS[m]}:</span> {PRISM_REFERENCE_AUDIO_MODE_HINTS[m]}
          </li>
        ))}
      </ul>
      {reasons.map((reason) => (
        <p key={reason} role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {reason}
        </p>
      ))}
    </div>
  )
}
