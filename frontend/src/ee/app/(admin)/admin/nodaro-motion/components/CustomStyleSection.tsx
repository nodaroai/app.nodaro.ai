// Admin → Video Remake, the custom style (the `nodaro_motion_custom_style`
// setting): whether this deployment offers a style in the person's own words
// (or put into words from an image) in place of a catalog art style, on a
// direct Nodaro Prism run, and the admin's own instructions and model for the
// engine's two LLM steps:
// - medium: reads a run's words and decides the style's medium and tones;
// - describe: puts an image's visual style into words.
//
// The switch is stored only once an admin chose a value: while none is, the
// deployment's default decides (on for Nodaro's own, off on a white-label
// one), so the draft keeps it left out until the admin picks the other value.
// A step field left empty is the engine's default, shown as the placeholder
// (or the model list's first option) and never written, so a later change of
// the engine's default takes effect. The defaults are the engine's, read at
// run time (GET …/custom-style/defaults); none is written here.
//
// The steps are checked by this environment's engine as they are edited
// (POST …/custom-style/check, debounced as the preparation steps are), and a
// refused save's `issues` are said the same way, each at its field. Neither
// holds Save: the server refuses a step the engine finds wrong.
//
// Where this environment's engine takes no custom style (`supported` false, or
// no defaults), the switch still saves; the steps are greyed out, with only
// taking back a saved value left choosable, as the preparation steps are.

import { useEffect, useId, useState } from "react"
import { getLlmModalityCaps } from "@nodaro/shared/llm-models"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  validationIssuesOf,
  type NodaroMotionCustomStyle,
  type NodaroMotionCustomStyleProblem,
  type NodaroMotionCustomStyleStep,
  type NodaroMotionCustomStyleStepName,
  type NodaroMotionCustomStyleView,
} from "@/lib/api"
import { useAdminLlmModels, type AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"
import { useNodaroMotionCustomStyleCheck, useNodaroMotionCustomStyleDefaults } from "@/ee/hooks/queries/use-nodaro-motion-custom-style"
import { Problems } from "../../trends/components/LlmStepEditor"
import { STEPS_CHECK_DEBOUNCE_MS } from "../../trends/components/StepsEditor"

export const CUSTOM_STYLE_HEADING = "Custom style"

export const CUSTOM_STYLE_SWITCH_LABEL = "Custom style offered"

/** The switch's hint: what it does, and this deployment's default. */
export function customStyleSwitchHint(enabledByDefault: boolean): string {
  return `People can describe a style in their own words, or from an image, instead of picking an art style. Nodaro Prism only. This deployment's default: ${enabledByDefault ? "on" : "off"}.`
}

/** Said where this environment's engine takes no custom style. */
export const CUSTOM_STYLE_UNSUPPORTED = "This environment's engine does not take a custom style yet: nothing here is read until it does."

/** The two steps, in the order shown. */
export const CUSTOM_STYLE_STEPS: ReadonlyArray<{ name: NodaroMotionCustomStyleStepName; title: string; hint: string; pictures: boolean }> = [
  { name: "medium", title: "Medium step", hint: "Reads a run's words and decides the style's medium and tones.", pictures: false },
  { name: "describe", title: "Describe step", hint: "Puts an image's visual style into words.", pictures: true },
]

/** A step as saved: its instructions when not blank (as written), its model trimmed when not blank; undefined when neither. */
function stepToSaved(step: NodaroMotionCustomStyleStep | undefined): NodaroMotionCustomStyleStep | undefined {
  const out: NodaroMotionCustomStyleStep = {}
  if (typeof step?.instructions === "string" && step.instructions.trim() !== "") out.instructions = step.instructions
  if (typeof step?.model === "string" && step.model.trim() !== "") out.model = step.model.trim()
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The setting as it is saved (the server's own reading): `enabled` only when an admin chose a value, a step only when
 * it holds instructions or a model of the admin's own. A new object.
 */
export function customStyleToSaved(draft: NodaroMotionCustomStyle | null | undefined): NodaroMotionCustomStyle {
  const out: NodaroMotionCustomStyle = {}
  if (typeof draft?.enabled === "boolean") out.enabled = draft.enabled
  for (const { name } of CUSTOM_STYLE_STEPS) {
    const step = stepToSaved(draft?.[name])
    if (step) out[name] = step
  }
  return out
}

/** The steps alone, as the check takes them, as a string ("" when no step is set: nothing to check). */
function stepsKey(draft: NodaroMotionCustomStyle): string {
  const steps = customStyleToSaved(draft)
  delete steps.enabled
  return Object.keys(steps).length > 0 ? JSON.stringify(steps) : ""
}

/** The problems under `prefix`, their paths made relative to it. */
function under(problems: readonly NodaroMotionCustomStyleProblem[], prefix: string): NodaroMotionCustomStyleProblem[] {
  return problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`)).map((p) => ({ ...p, path: p.path.slice(prefix.length + 1) }))
}

/** The edited value as it settles (debounced). */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

interface Props {
  /** The live setting (its GET). */
  readonly view: NodaroMotionCustomStyleView
  /** The draft, in its saved form (`enabled` left out: the deployment's default). */
  readonly value: NodaroMotionCustomStyle
  readonly onChange: (next: NodaroMotionCustomStyle) => void
  /** The last save's refusal: its `issues` said at their fields. */
  readonly saveError: unknown
}

export function CustomStyleSection({ view, value, onChange, saveError }: Props) {
  const id = useId()
  const switchId = `${id}-switch`
  const hintId = `${id}-hint`
  const defaultsQuery = useNodaroMotionCustomStyleDefaults(view.supported)
  const defaults = view.supported && defaultsQuery.data ? defaultsQuery.data.defaults : undefined
  const unsupported = !view.supported || defaultsQuery.data === null
  const [models, setModels] = useState<readonly AdminLlmModel[] | undefined>(undefined)

  const current = stepsKey(value)
  const settled = useSettled(current, STEPS_CHECK_DEBOUNCE_MS)
  const check = useNodaroMotionCustomStyleCheck(settled, !!defaults)
  // A refused save's fields first; else the check of the steps as they stand now (never a former draft's).
  const saveIssues: NodaroMotionCustomStyleProblem[] = validationIssuesOf(saveError).map((i) => ({ ...i, code: i.code ?? "validation_error" }))
  const problems = saveIssues.length > 0 ? saveIssues : defaults && check.data && settled === current ? check.data : []
  const saveMessage = saveError instanceof Error && saveIssues.length === 0 ? saveError.message : undefined
  const rest = problems.filter((p) => !CUSTOM_STYLE_STEPS.some((s) => p.path === `customStyle.${s.name}` || p.path.startsWith(`customStyle.${s.name}.`)))

  const checked = value.enabled ?? view.enabledByDefault
  const setEnabled = (next: boolean) => {
    const out: NodaroMotionCustomStyle = { ...value }
    // Stored only once an admin chose a value: back at the deployment's default with none saved, it stays left out.
    if (typeof view.customStyle?.enabled === "boolean" || next !== view.enabledByDefault) out.enabled = next
    else delete out.enabled
    onChange(out)
  }
  const setStep = (name: NodaroMotionCustomStyleStepName, step: NodaroMotionCustomStyleStep | undefined) => {
    const out: NodaroMotionCustomStyle = { ...value }
    if (step) out[name] = step
    else delete out[name]
    onChange(out)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm" data-testid="custom-style">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={switchId} className="font-medium">
            {CUSTOM_STYLE_SWITCH_LABEL}
          </Label>
          <p id={hintId} className="text-xs text-muted-foreground">
            {customStyleSwitchHint(view.enabledByDefault)}
          </p>
        </div>
        <Switch id={switchId} className="mt-0.5" checked={checked} onCheckedChange={setEnabled} aria-describedby={hintId} />
      </div>
      {unsupported ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {CUSTOM_STYLE_UNSUPPORTED}
        </p>
      ) : defaultsQuery.error ? (
        <p className="text-xs text-destructive">{defaultsQuery.error.message}</p>
      ) : !defaults ? (
        <p className="text-xs text-muted-foreground">Loading the engine's defaults…</p>
      ) : null}
      {defaults && <ModelsReader onModels={setModels} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {CUSTOM_STYLE_STEPS.map((s) => (
          <StepEditor
            key={s.name}
            title={s.title}
            hint={s.hint}
            pictures={s.pictures}
            value={value[s.name]}
            defaults={defaults?.[s.name]}
            models={defaults ? models : undefined}
            problems={under(problems, `customStyle.${s.name}`)}
            onChange={(step) => setStep(s.name, step)}
          />
        ))}
      </div>
      <Problems list={rest} />
      {saveMessage && (
        <p role="alert" className="text-xs text-destructive">
          {saveMessage}
        </p>
      )}
    </div>
  )
}

/** Reads the admin LLM models list (mounted only while the engine's defaults are in). */
function ModelsReader({ onModels }: { readonly onModels: (models: readonly AdminLlmModel[] | undefined) => void }) {
  const { data } = useAdminLlmModels()
  useEffect(() => onModels(data?.models), [data, onModels])
  return null
}

interface StepProps {
  readonly title: string
  readonly hint: string
  /** The step is shown an image: only the models that take images are offered. */
  readonly pictures: boolean
  readonly value: NodaroMotionCustomStyleStep | undefined
  /** The engine's default for the step (unknown while loading, or where the engine takes no custom style: greyed out). */
  readonly defaults: { model: string; instructions: string } | undefined
  readonly models: readonly AdminLlmModel[] | undefined
  /** The problems for this step, their paths relative to it ("instructions", "model"). */
  readonly problems: readonly NodaroMotionCustomStyleProblem[]
  readonly onChange: (next: NodaroMotionCustomStyleStep | undefined) => void
}

function StepEditor({ title, hint, pictures, value, defaults, models, problems, onChange }: StepProps) {
  const id = useId()
  const disabled = !defaults
  const set = (patch: Partial<NodaroMotionCustomStyleStep>) => {
    const next: NodaroMotionCustomStyleStep = { ...(value ?? {}), ...patch }
    if (next.instructions === undefined || next.instructions === "") delete next.instructions
    if (next.model === undefined || next.model === "") delete next.model
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }
  const offered = (models ?? []).filter((m) => m.isEnabled && (!pictures || getLlmModalityCaps(m.id).image))
  const model = value?.model ?? ""
  const unlisted = model !== "" && !offered.some((m) => m.id === model)
  const at = (field: string) => problems.filter((p) => p.path === field || p.path.startsWith(`${field}.`))
  const others = problems.filter((p) => !["instructions", "model"].includes(p.path.split(".")[0] ?? ""))

  return (
    <div role="group" aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
      <div>
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-model`} className="font-medium">
          <span className="sr-only">{title}:</span> Model
        </label>
        <select
          id={`${id}-model`}
          className="h-9 min-h-9 rounded-md border bg-background px-2 text-sm"
          value={model}
          onChange={(e) => set({ model: e.target.value })}
        >
          <option value="">{defaults ? `The engine's default (${defaults.model})` : "The engine's default"}</option>
          {unlisted && <option value={model}>{models !== undefined ? `${model} (not offered)` : model}</option>}
          {offered.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        {defaults && models === undefined && <span className="text-xs text-muted-foreground">Loading the models…</span>}
        {pictures && defaults && <span className="text-xs text-muted-foreground">Only models that take pictures are offered: this step is shown an image.</span>}
        <Problems list={at("model")} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-instructions`} className="font-medium">
            <span className="sr-only">{title}:</span> Instructions
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9"
            aria-label={`${title}: Reset to default`}
            disabled={value?.instructions === undefined}
            onClick={() => set({ instructions: undefined })}
          >
            Reset to default
          </Button>
        </div>
        <Textarea
          id={`${id}-instructions`}
          rows={6}
          value={value?.instructions ?? ""}
          placeholder={defaults?.instructions}
          disabled={disabled}
          aria-describedby={`${id}-instructions-hint`}
          onChange={(e) => set({ instructions: e.target.value })}
        />
        <span id={`${id}-instructions-hint`} className="text-xs text-muted-foreground">
          Empty: the engine's default (shown greyed out above).
        </span>
        <Problems list={at("instructions")} />
      </div>
      <Problems list={others} />
    </div>
  )
}
