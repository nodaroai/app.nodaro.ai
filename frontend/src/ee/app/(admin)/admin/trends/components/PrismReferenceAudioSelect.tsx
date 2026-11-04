// What audio the reference video a Nodaro Motion Prism run sends to the video
// model carries, per output resolution: a mode (no audio, the clip's whole
// mix, only the vocals, or either flattened to one steady tone) and a pitch
// shift in semitones (-24 to 24 in steps of 0.5; 0 = none; none for No audio),
// applied before the flattening. Picking a mode moves the pitch shift to that
// mode's default (0 for a one-tone mode, +4 for the others), never one the
// admin typed or saved off its default. The original audio always goes back
// on the result. Every environment shares one database, so what only some take
// (the one-tone modes, and any pitch shift no id says, which older code cannot
// read) is offered once EVERY environment takes it: its engine's flag and its
// platform's claim, each named apart while one is missing (`envs`). Until then
// it is greyed out, unless a resolution already has it (it stays, to be set to
// another). The trend editor shows it under the Model while the model is
// Prism; Admin → Nodaro Motion shows it in the Prism engine's section, for
// direct runs.

import { useId, useState } from "react"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CastSwapPrismReferenceAudioByResolution, CastSwapPrismReferenceAudioId, CastSwapPrismReferenceAudioMode, TrendEngineEnvironment, TrendResolution } from "@/lib/api"
import {
  PRISM_REFERENCE_AUDIO_MODES,
  PRISM_REFERENCE_AUDIO_MODE_LABELS,
  PRISM_REFERENCE_AUDIO_SEMITONES,
  PRISM_RESOLUTIONS,
  prismReferenceAudioDefaultSemitones,
  prismReferenceAudioMissing,
  prismReferenceAudioOfferOfEvery,
  prismReferenceAudioSwitchMode,
  prismReferenceAudioTriple,
  type PrismReferenceAudioFormValue,
} from "../prism-reference-audio"

/** What the one-tone modes do (the others say it in their names). */
export const PRISM_REFERENCE_AUDIO_MODE_HINTS: Readonly<Partial<Record<CastSwapPrismReferenceAudioMode, string>>> = {
  "full-one-tone": "The whole mix flattened to one steady tone, after the pitch shift.",
  "voice-one-tone": "Only the vocals, flattened to one steady tone, after the pitch shift. With no vocals the reference is silent.",
}

export const PRISM_REFERENCE_AUDIO_HINT =
  "What the engine hears in the reference video, per output resolution. The original audio always goes back on the result."

export const PRISM_REFERENCE_AUDIO_PITCH_LABEL = "Pitch shift (semitones)"
export const PRISM_REFERENCE_AUDIO_PITCH_HINT = "0 = no pitch shift"

/** Said under a resolution whose mode is offered but whose pitch shift is not. */
const PITCH_UNOFFERED = "This pitch shift is not supported yet."

/** Why every environment must take it. */
const SHARED_BY = { setting: "this setting is shared by every environment", trend: "trends are shared by every environment" } as const

/**
 * Said in place of what each environment lacks when nothing can be said of them: fail-closed, and it names none. True
 * beside a closed field, an open one and a held one, as Save holds: a trend's draft still takes a value an id says, and
 * the one new pitch shift among those is the Octave's (`prismReferenceAudioHeldIssues`' `idsToo`).
 */
const ENVS_UNREADABLE: Readonly<Record<keyof typeof SHARED_BY, string>> = {
  setting: "The environments could not be read, so a new pitch shift or one-tone mode can't be saved yet. Reload the page to try again.",
  trend: "The environments could not be read, so a new pitch shift (other than Full mix at +12) or one-tone mode can't be saved yet. Reload the page to try again.",
}

/**
 * One set of column widths for every row and the pitch shift's heading, so they line up from 640 px up: the resolution,
 * the select with the room left, then the field. Below 640 px each row is a stack.
 */
const ROW_COLUMNS = "sm:grid sm:grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] sm:gap-x-2"

interface Props {
  /** As stored (a plain id from earlier = that id at every resolution); undefined (or null) = none set (the default, the full mix at +4). */
  readonly value: CastSwapPrismReferenceAudioByResolution | CastSwapPrismReferenceAudioId | null | undefined
  /** Every resolution's mode and pitch shift, the one changed included. */
  readonly onChange: (next: CastSwapPrismReferenceAudioByResolution) => void
  readonly label?: string
  /** Said under the hint (e.g. that this environment's engine does not take it yet). */
  readonly note?: string
  /**
   * Each environment's engine and platform, as reported: what only some take is
   * offered once every one does, each missing one named. Left out (still
   * loading, or `envsUnreadable`): only what every engine takes.
   */
  readonly envs?: readonly TrendEngineEnvironment[]
  /** The environments could not be read: said in words, naming none (nothing is said while they are only loading). */
  readonly envsUnreadable?: boolean
  /** What the reasons say is shared by every environment: Admin → Nodaro Motion's setting (the default), or a trend. */
  readonly sharedBy?: keyof typeof SHARED_BY
}

export function PrismReferenceAudioSelect({ value, onChange, label = "Prism reference audio", note, envs, envsUnreadable = false, sharedBy = "setting" }: Props) {
  const id = useId()
  const hintId = `${id}-prism-reference-audio-hint`
  const pitchHintId = `${id}-prism-reference-audio-pitch-hint`
  const current = prismReferenceAudioTriple(value)
  // The resolutions whose pitch shift is the admin's own (typed here, or found off its mode's default): a mode switch keeps it.
  const [own, setOwn] = useState<ReadonlySet<TrendResolution>>(() => new Set())
  const markOwn = (resolution: TrendResolution) => setOwn((s) => (s.has(resolution) ? s : new Set(s).add(resolution)))
  const set = (resolution: TrendResolution, next: PrismReferenceAudioFormValue) => onChange({ ...current, [resolution]: next })
  const offered = prismReferenceAudioOfferOfEvery(envs)
  const missing = prismReferenceAudioMissing(envs)
  const switchMode = (resolution: TrendResolution, mode: CastSwapPrismReferenceAudioMode) => {
    const next = prismReferenceAudioSwitchMode(current[resolution], mode, own.has(resolution), offered.pitch)
    if (next.own) markOwn(resolution)
    set(resolution, next.value)
  }
  // Nothing is known while the environments are not: greyed out, but not said to be unsupported.
  const modeName = (mode: CastSwapPrismReferenceAudioMode) => `${PRISM_REFERENCE_AUDIO_MODE_LABELS[mode]}${offered.mode(mode) || !envs ? "" : " (not supported yet)"}`
  const shared = SHARED_BY[sharedBy]
  const voiceOneTone = PRISM_REFERENCE_AUDIO_MODE_LABELS["voice-one-tone"]
  // What is missing, each said apart and naming its environments (the same reasons, in both screens).
  const engineName = (names: readonly string[], what: string) => `The Cast Swap engine of ${names.join(", ")} cannot take ${what} yet, and ${shared}.`
  const reasons = missing
    ? [
        ...(missing.engine.length > 0 ? [engineName(missing.engine, `a pitch shift or ${voiceOneTone}`)] : []),
        ...(missing.platform.length > 0 ? [`The platform in ${missing.platform.join(", ")} does not take a pitch shift or ${voiceOneTone} yet, and ${shared}.`] : []),
        ...(missing.modes["full-one-tone"].length > 0 ? [engineName(missing.modes["full-one-tone"], PRISM_REFERENCE_AUDIO_MODE_LABELS["full-one-tone"])] : []),
        // An engine without the flag was named above; here, one with it that does not list the mode.
        ...(missing.modes["voice-one-tone"].some((name) => !missing.engine.includes(name))
          ? [engineName(missing.modes["voice-one-tone"].filter((name) => !missing.engine.includes(name)), voiceOneTone)]
          : []),
      ]
    : envsUnreadable
      ? [ENVS_UNREADABLE[sharedBy]]
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
        {PRISM_RESOLUTIONS.map((resolution) => {
          const selectId = `${id}-prism-reference-audio-${resolution}`
          const pitchId = `${selectId}-pitch`
          const cur = current[resolution]
          const silent = cur.mode === "none"
          // The mode is offered here, but not at this pitch shift (said once the environments are known).
          const pitchUnoffered = !!envs && offered.mode(cur.mode) && !offered.value(cur)
          // Greyed out until every environment takes a pitch shift; one off its mode's default stays, to be set back, and
          // it never closes on a value that is itself held (the admin could not type it away).
          const pitchClosed = !offered.pitch && cur.semitones === prismReferenceAudioDefaultSemitones(cur.mode) && offered.value(cur)
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
                    <SelectItem key={mode} value={mode} disabled={!offered.mode(mode) && cur.mode !== mode} className="min-h-11 sm:min-h-0">
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
                // No audio has no pitch shift: the field is empty and off, and the next mode finds the one it kept.
                value={silent ? undefined : cur.semitones}
                min={min}
                max={max}
                step={step}
                snapToStep
                disabled={silent || pitchClosed}
                aria-invalid={pitchUnoffered || undefined}
                aria-describedby={pitchUnoffered ? `${pitchHintId} ${pitchId}-unoffered` : pitchHintId}
                onCommit={(semitones) => {
                  if (semitones === undefined) return
                  markOwn(resolution)
                  set(resolution, { ...cur, semitones })
                }}
              />
              {pitchUnoffered && (
                <p id={`${pitchId}-unoffered`} className="text-xs text-destructive sm:col-span-2 sm:col-start-2">
                  {PITCH_UNOFFERED}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <p id={pitchHintId} className="text-xs text-muted-foreground">
        {PRISM_REFERENCE_AUDIO_PITCH_HINT}
      </p>
      <p id={hintId} className="text-xs text-muted-foreground">
        {PRISM_REFERENCE_AUDIO_HINT}
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
