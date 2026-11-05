// Admin → Nodaro Motion, each engine's runs with no person (the
// `nodaro_motion_no_person` setting's entry for the engine): whether a direct
// Precise run with no person role with pictures sends its clip as it is. On is
// the default, left out of what is saved; off makes such a run prepare its clip
// as any Precise run does.
//
// The setting is shared by every environment, but only an engine that declares
// `castSwap.noPersonSourceClip` reads it. So turning it off is offered once ANY
// environment's engine declares it (the server refuses it otherwise, 409
// `engine_unsupported`), with a note naming the environments that do not yet.
// With none, it stays on, unless it is already off: a saved change can always be
// taken back.

import { useId } from "react"
import { NODARO_MOTION_ENGINES } from "@nodaro/shared/models"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { NodaroMotionEngine, NodaroMotionNoPerson, NodaroMotionNoPersonEntry, TrendEngineEnvironment } from "@/lib/api"
import { SHARED_SETTING_ENVIRONMENTS, environmentsThatCannotSendSourceClip } from "../../trends/clip-preparation"

export const NO_PERSON_LEGEND = "Runs with no person: send the clip as it is"

export const NO_PERSON_HINT =
  "A Precise run with no person role with pictures sends the clip unprepared. If the model refuses the clip or what it would make, the clip is prepared and retried once, charged only then. A run with an art style may run as Flex instead."

export const NO_PERSON_NOTE = "This setting is shared by every environment."

/** Said while no environment's engine reads the setting: only the default can be saved. */
export const NO_ENVIRONMENT_READS_NO_PERSON = "No environment's Cast Swap engine reads this setting yet: only the default (on) can be saved."

/** Said under the column when this environment's engine does not read the setting. */
export const NO_PERSON_UNSUPPORTED_HERE = "This environment's engine does not read this setting yet."

/** Said when some environments' engines do not read the setting. */
export function noPersonMissingNote(missing: readonly string[]): string {
  return `The Cast Swap engine of ${missing.join(", ")} does not read this setting yet.`
}

/** The setting as it is saved (the server's own reading): only an engine switched off, in the engines' order. New objects. */
export function noPersonToSaved(draft: NodaroMotionNoPerson | null | undefined): NodaroMotionNoPerson {
  const out: NodaroMotionNoPerson = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    if (draft?.[engine]?.sourceClip === false) out[engine] = { sourceClip: false }
  }
  return out
}

interface Props {
  /** The engine this switch belongs to. */
  readonly engine: NodaroMotionEngine
  /** The draft; undefined = the default (on). */
  readonly value: NodaroMotionNoPersonEntry | undefined
  readonly onChange: (next: NodaroMotionNoPersonEntry) => void
  /** Each environment's engine, as reported (unknown while loading: only the default). */
  readonly envs: readonly TrendEngineEnvironment[] | undefined
  /** Whether this environment's engine reads the setting (the setting's GET). */
  readonly supported: boolean
  /** The last save's refusal, said in place. */
  readonly error?: string
}

export function NoPersonColumn({ engine, value, onChange, envs, supported, error }: Props) {
  const id = useId()
  const switchId = `${id}-source-clip`
  const hintId = `${id}-source-clip-hint`
  const missing = environmentsThatCannotSendSourceClip(envs)
  // One environment's engine reading the row is enough (the server's rule).
  const offered = missing !== undefined && missing.length < SHARED_SETTING_ENVIRONMENTS.length
  const on = value?.sourceClip !== false

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="no-person-column" data-engine={engine}>
      <div className="flex items-start justify-between gap-3 text-sm">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={switchId} className="font-medium">
            {NO_PERSON_LEGEND}
          </Label>
          <p id={hintId} className="text-xs text-muted-foreground">
            {NO_PERSON_HINT}
          </p>
        </div>
        <Switch
          id={switchId}
          className="mt-0.5"
          checked={on}
          // A change waits for an engine that reads it; a setting already off stays changeable, so it can be taken back.
          disabled={on && !offered}
          aria-describedby={hintId}
          onCheckedChange={(checked) => onChange(checked ? {} : { sourceClip: false })}
        />
      </div>
      <p className="text-xs text-muted-foreground">{NO_PERSON_NOTE}</p>
      {missing === undefined ? (
        <p className="text-xs text-muted-foreground">Checking the environments…</p>
      ) : !offered ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {NO_ENVIRONMENT_READS_NO_PERSON}
        </p>
      ) : missing.length > 0 ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {noPersonMissingNote(missing)}
        </p>
      ) : null}
      {!supported && <p className="text-xs text-muted-foreground">{NO_PERSON_UNSUPPORTED_HERE}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
