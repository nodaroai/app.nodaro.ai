// Admin → Nodaro Motion, Prism's style-only runs (the `nodaro_motion_style_only`
// setting's entry for the engine): what a direct run does that has a video
// and an art style and nothing to swap (no role with pictures, no fixed
// reference). Pulse takes no art style, so it has none.
//
// Two choices, each left out at its default:
// - the path: "Original clip" (the default: the clip itself, restyled, with
//   no depth) or "Like other styles" (full depth with the Motion setting and
//   the Flexible prompt, as any art-style run with roles);
// - the style-only engine prompt: Template (the default) or LLM
//   (TextStepSwitch.tsx, seeded with the engine prompt step's defaults). Its
//   own step: never the preparation steps' engine prompt.
//
// The setting is shared by every environment, but only an engine that runs
// style-only runs (`castSwap.styleOnly`) reads it; one without it refuses
// such a run anyway. So a change is offered once ANY environment's engine
// declares it (the server refuses it otherwise, 409 `engine_unsupported`),
// with a note naming the environments that do not yet. With none, only the
// defaults stay choosable, so a saved change can always be taken back.

import { useEffect, useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import {
  fetchStepDefaults,
  type NodaroMotionEngine,
  type NodaroMotionStyleOnly,
  type NodaroMotionStyleOnlyEntry,
  type NodaroMotionStyleOnlyPath,
  type TrendEngineEnvironment,
} from "@/lib/api"
import { useAdminLlmModels, type AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"
import { TextStepSwitch } from "../../trends/components/TextStepSwitch"
import { SHARED_SETTING_ENVIRONMENTS, environmentsThatCannotRunStyleOnly } from "../../trends/clip-preparation"

export const STYLE_ONLY_LEGEND = "Style-only runs (a video and an art style, nothing swapped)"

export const STYLE_ONLY_PATHS: ReadonlyArray<{ value: NodaroMotionStyleOnlyPath; label: string; hint: string }> = [
  { value: "original", label: "Original clip", hint: "Sends the clip itself, with no depth, so the scene stays as filmed." },
  { value: "flex", label: "Like other styles", hint: "Full depth with the Motion setting and the Flexible prompt, as an art-style run with roles." },
]

export const STYLE_ONLY_ENGINE_PROMPT_LABEL = "Style-only engine prompt"

/** Said while no environment's engine runs style-only runs: only the defaults can be saved. */
export const NO_ENVIRONMENT_RUNS_STYLE_ONLY =
  "No environment's Cast Swap engine runs style-only runs yet: only the defaults (Original clip, Template) can be saved."

/** Said under the column when this environment's engine does not run style-only runs. */
export const STYLE_ONLY_UNSUPPORTED_HERE = "This environment's engine does not run style-only runs yet."

/** Said when some environments' engines do not run style-only runs (they never read this setting). */
export function styleOnlyMissingNote(missing: readonly string[]): string {
  return `The Cast Swap engine of ${missing.join(", ")} does not run style-only runs yet: it never reads this setting.`
}

/**
 * The setting as it is saved (the server's own reading): an engine's path only when "flex", its engine prompt only
 * when not the template, an engine with neither left out. Unset keys are omitted, never null. New objects.
 */
export function styleOnlyToSaved(draft: NodaroMotionStyleOnly | null | undefined): NodaroMotionStyleOnly {
  const out: NodaroMotionStyleOnly = {}
  for (const [id, entry] of Object.entries(draft ?? {}) as Array<[NodaroMotionEngine, NodaroMotionStyleOnlyEntry | undefined]>) {
    const kept: NodaroMotionStyleOnlyEntry = {}
    if (entry?.path === "flex") kept.path = "flex"
    if (entry?.enginePrompt && entry.enginePrompt.mode !== "template") kept.enginePrompt = structuredClone(entry.enginePrompt)
    if (Object.keys(kept).length > 0) out[id] = kept
  }
  return out
}

interface Props {
  /** The engine whose step defaults seed the LLM (Prism). */
  readonly engine: NodaroMotionEngine
  /** The draft; undefined = the defaults. */
  readonly value: NodaroMotionStyleOnlyEntry | undefined
  readonly onChange: (next: NodaroMotionStyleOnlyEntry) => void
  /** Each environment's engine, as reported (unknown while loading: only the defaults). */
  readonly envs: readonly TrendEngineEnvironment[] | undefined
  /** Whether this environment's engine runs style-only runs (the setting's GET). */
  readonly supported: boolean
  /** The last save's refusal, said in place. */
  readonly error?: string
}

export function StyleOnlyColumn({ engine, value, onChange, envs, supported, error }: Props) {
  const id = useId()
  const missing = environmentsThatCannotRunStyleOnly(envs)
  // One environment's engine reading the row is enough (the server's rule).
  const offered = missing !== undefined && missing.length < SHARED_SETTING_ENVIRONMENTS.length
  const path = value?.path ?? "original"
  const defaultsQuery = useQuery({
    queryKey: ["admin", "nodaro-motion", "steps", "defaults", engine],
    queryFn: () => fetchStepDefaults(engine),
    enabled: hasAdmin() && offered,
    staleTime: 60_000,
  })
  const defaults = offered ? defaultsQuery.data?.defaults.enginePrompt : undefined
  const [models, setModels] = useState<readonly AdminLlmModel[] | undefined>(undefined)

  const set = (patch: Partial<NodaroMotionStyleOnlyEntry>) => {
    const next: NodaroMotionStyleOnlyEntry = { ...(value ?? {}), ...patch }
    for (const k of Object.keys(patch) as Array<keyof NodaroMotionStyleOnlyEntry>) if (patch[k] === undefined) delete next[k]
    onChange(next)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="style-only-column">
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="font-medium">{STYLE_ONLY_LEGEND}</legend>
        {STYLE_ONLY_PATHS.map((o) => {
          const optionId = `${id}-${o.value}`
          const checked = path === o.value
          // A change waits for an engine that reads it; the default (and a saved choice) stays choosable.
          const off = o.value !== "original" && !offered && !checked
          return (
            <div key={o.value} className="flex min-h-11 items-start gap-2">
              <input
                id={optionId}
                type="radio"
                name={`${id}-path`}
                className="mt-1 h-4 w-4"
                checked={checked}
                disabled={off}
                aria-describedby={`${optionId}-hint`}
                onChange={() => set({ path: o.value === "original" ? undefined : o.value })}
              />
              <div className="flex min-w-0 flex-col">
                <label htmlFor={optionId} className="font-medium">
                  {o.label}
                  {o.value === "original" ? " (default)" : ""}
                </label>
                <span id={`${optionId}-hint`} className="text-xs text-muted-foreground">
                  {o.hint}
                </span>
              </div>
            </div>
          )
        })}
      </fieldset>
      <div className="flex min-w-0 flex-col gap-1">
        <h4 className="text-sm font-medium">
          {STYLE_ONLY_ENGINE_PROMPT_LABEL}
        </h4>
        <TextStepSwitch
          label={STYLE_ONLY_ENGINE_PROMPT_LABEL}
          value={value?.enginePrompt}
          defaults={defaults}
          models={defaults ? models : undefined}
          lengthNote="the run caps it further: the engine's prompt cap"
          disabled={!offered}
          onChange={(enginePrompt) => set({ enginePrompt: enginePrompt?.mode === "llm" ? enginePrompt : undefined })}
        />
      </div>
      {offered && <ModelsReader onModels={setModels} />}
      {missing === undefined ? (
        <p className="text-xs text-muted-foreground">Checking the environments…</p>
      ) : !offered ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {NO_ENVIRONMENT_RUNS_STYLE_ONLY}
        </p>
      ) : missing.length > 0 ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {styleOnlyMissingNote(missing)}
        </p>
      ) : null}
      {!supported && <p className="text-xs text-muted-foreground">{STYLE_ONLY_UNSUPPORTED_HERE}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** Reads the admin LLM models list (mounted only while a change is offered). */
function ModelsReader({ onModels }: { readonly onModels: (models: readonly AdminLlmModel[] | undefined) => void }) {
  const { data } = useAdminLlmModels()
  useEffect(() => onModels(data?.models), [data, onModels])
  return null
}
