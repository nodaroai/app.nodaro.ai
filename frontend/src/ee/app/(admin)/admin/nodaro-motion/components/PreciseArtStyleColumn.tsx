// Admin → Nodaro Motion, Prism's Precise runs with an art style (the
// `nodaro_motion_precise_art_style` setting's entry for the engine): how a
// direct Precise run that carries an art style opens its prompt. Pulse takes
// no art style, so it has none.
//
// Two choices:
// - the opener: "Restyle" (the default: "restyle {video:1} as follows:") or
//   "Edit" (the Precise opener of before, "edit {video:1} as follows:"),
//   left out at its default. The rest of the prompt is the engine's: the
//   Precise prompt with the art style's lines.
// - "Style the role pictures" for these runs: their OWN switch (the
//   preparation steps' StyleRefsStep control, Off by default), never the
//   preparation steps' switch below, which is the Flex runs'. Saved as picked,
//   Off included (its send and instruction kept), as the steps' own is.
//
// The setting is shared by every environment, but only an engine that takes
// an art style on a Precise run (`castSwap.preciseArtStyle`) reads it; one
// without it refuses such a run anyway. So a change is offered once ANY
// environment's engine declares it (the server refuses it otherwise, 409
// `engine_unsupported`), with a note naming the environments that do not yet.
// With none, only the default stays choosable, so a saved change can always
// be taken back.

import { useId } from "react"
import { useQuery } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import {
  fetchStepDefaults,
  type NodaroMotionEngine,
  type NodaroMotionPreciseArtStyle,
  type NodaroMotionPreciseArtStyleEntry,
  type NodaroMotionPreciseOpener,
  type TrendEngineEnvironment,
} from "@/lib/api"
import { SHARED_SETTING_ENVIRONMENTS, environmentsThatCannotTakePreciseArtStyle } from "../../trends/clip-preparation"
import { StyleRefsStep } from "../../trends/components/StyleRefsStep"

export const PRECISE_ART_STYLE_LEGEND = "Precise runs with an art style: the prompt's opener"

export const PRECISE_OPENERS: ReadonlyArray<{ value: NodaroMotionPreciseOpener; label: string; hint: string }> = [
  { value: "restyle", label: "Restyle", hint: "Opens the prompt with “restyle {video:1} as follows:”." },
  { value: "edit", label: "Edit", hint: "Opens it with “edit {video:1} as follows:”, the Precise opener without an art style." },
]

/** Said while no environment's engine takes an art style on a Precise run: only the default can be saved. */
export const NO_ENVIRONMENT_TAKES_PRECISE_ART_STYLE =
  "No environment's Cast Swap engine takes an art style on a Precise run yet: only the default (Restyle) can be saved."

/** Said under the column when this environment's engine does not take one. */
export const PRECISE_ART_STYLE_UNSUPPORTED_HERE = "This environment's engine does not take an art style on a Precise run yet."

/** Said when some environments' engines do not take one (they never read this setting). */
export function preciseArtStyleMissingNote(missing: readonly string[]): string {
  return `The Cast Swap engine of ${missing.join(", ")} does not take an art style on a Precise run yet: it never reads this setting.`
}

/** The heading of these runs' own "Style the role pictures". */
export const PRECISE_STYLE_REFS_LABEL = "Style the role pictures (Precise runs with an art style)"

/** Said under it: the preparation steps' switch is the Flex runs'. */
export const PRECISE_STYLE_REFS_NOTE = "Its own switch: the preparation steps' Style the role pictures is the Flex runs' alone."

/**
 * The setting as it is saved (the server's own reading): an engine's opener only when "edit", its style-refs step as
 * picked (Off included), an engine with neither left out. New objects.
 */
export function preciseArtStyleToSaved(draft: NodaroMotionPreciseArtStyle | null | undefined): NodaroMotionPreciseArtStyle {
  const out: NodaroMotionPreciseArtStyle = {}
  for (const [id, entry] of Object.entries(draft ?? {}) as Array<[NodaroMotionEngine, NodaroMotionPreciseArtStyleEntry | undefined]>) {
    const kept: NodaroMotionPreciseArtStyleEntry = {}
    if (entry?.opener === "edit") kept.opener = "edit"
    if (entry?.styleRefs) kept.styleRefs = structuredClone(entry.styleRefs)
    if (Object.keys(kept).length > 0) out[id] = kept
  }
  return out
}

interface Props {
  /** The engine whose step defaults seed the style-refs step (Prism). */
  readonly engine: NodaroMotionEngine
  /** The draft; undefined = the default. */
  readonly value: NodaroMotionPreciseArtStyleEntry | undefined
  readonly onChange: (next: NodaroMotionPreciseArtStyleEntry) => void
  /** Each environment's engine, as reported (unknown while loading: only the default). */
  readonly envs: readonly TrendEngineEnvironment[] | undefined
  /** Whether this environment's engine takes an art style on a Precise run (the setting's GET). */
  readonly supported: boolean
  /** The last save's refusal, said in place. */
  readonly error?: string
}

export function PreciseArtStyleColumn({ engine, value, onChange, envs, supported, error }: Props) {
  const id = useId()
  const missing = environmentsThatCannotTakePreciseArtStyle(envs)
  // One environment's engine reading the row is enough (the server's rule).
  const offered = missing !== undefined && missing.length < SHARED_SETTING_ENVIRONMENTS.length
  const opener = value?.opener ?? "restyle"
  const defaultsQuery = useQuery({
    queryKey: ["admin", "nodaro-motion", "steps", "defaults", engine],
    queryFn: () => fetchStepDefaults(engine),
    enabled: hasAdmin() && offered,
    staleTime: 60_000,
  })
  const styleRefsDefaults = offered ? defaultsQuery.data?.defaults.styleRefs : undefined
  const set = (patch: Partial<NodaroMotionPreciseArtStyleEntry>) => {
    const next: NodaroMotionPreciseArtStyleEntry = { ...(value ?? {}), ...patch }
    for (const k of Object.keys(patch) as Array<keyof NodaroMotionPreciseArtStyleEntry>) if (patch[k] === undefined) delete next[k]
    onChange(next)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="precise-art-style-column">
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="font-medium">{PRECISE_ART_STYLE_LEGEND}</legend>
        {PRECISE_OPENERS.map((o) => {
          const optionId = `${id}-${o.value}`
          const checked = opener === o.value
          // A change waits for an engine that reads it; the default (and a saved choice) stays choosable.
          const off = o.value !== "restyle" && !offered && !checked
          return (
            <div key={o.value} className="flex min-h-11 items-start gap-2">
              <input
                id={optionId}
                type="radio"
                name={`${id}-opener`}
                className="mt-1 h-4 w-4"
                checked={checked}
                disabled={off}
                aria-describedby={`${optionId}-hint`}
                onChange={() => set({ opener: o.value === "restyle" ? undefined : o.value })}
              />
              <div className="flex min-w-0 flex-col">
                <label htmlFor={optionId} className="font-medium">
                  {o.label}
                  {o.value === "restyle" ? " (default)" : ""}
                </label>
                <span id={`${optionId}-hint`} className="text-xs text-muted-foreground">
                  {o.hint}
                </span>
              </div>
            </div>
          )
        })}
      </fieldset>
      <div role="group" aria-label={PRECISE_STYLE_REFS_LABEL} className="flex min-w-0 flex-col gap-1">
        <h4 className="text-sm font-medium">{PRECISE_STYLE_REFS_LABEL}</h4>
        <p className="text-xs text-muted-foreground">{PRECISE_STYLE_REFS_NOTE}</p>
        <StyleRefsStep
          value={value?.styleRefs}
          defaults={styleRefsDefaults}
          // On waits for an engine that reads this row (the note below names the others); Off is always choosable.
          offered={offered && !!styleRefsDefaults}
          notYetIn={[]}
          problems={[]}
          onChange={(styleRefs) => set({ styleRefs })}
        />
      </div>
      {missing === undefined ? (
        <p className="text-xs text-muted-foreground">Checking the environments…</p>
      ) : !offered ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {NO_ENVIRONMENT_TAKES_PRECISE_ART_STYLE}
        </p>
      ) : missing.length > 0 ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {preciseArtStyleMissingNote(missing)}
        </p>
      ) : null}
      {!supported && <p className="text-xs text-muted-foreground">{PRECISE_ART_STYLE_UNSUPPORTED_HERE}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
