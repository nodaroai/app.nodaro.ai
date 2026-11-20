// Admin → Video Remake, the roles from the prompt (the `nodaro_motion_plan_roles`
// setting): whether this deployment offers roles planned from a person's own
// words and loose reference images (the engine says which subject of the video
// each image replaces, before anything runs), and the admin's own instructions
// and model for the engine's one LLM step:
// - plan: reads the request and the images, and gives each image its role.
//
// The switch is stored only once an admin chose a value: while none is, the
// deployment's default decides (on for Nodaro's own, off on a white-label
// one), so the draft keeps it left out until the admin picks the other value.
// A step field left empty is the engine's default, shown as the placeholder
// (or the model list's first option) and never written, so a later change of
// the engine's default takes effect. The defaults are the engine's, read at
// run time (GET …/plan-roles/defaults); none is written here.
//
// The engine also answers its default instructions as a template, with the
// `<max…>` placeholders it fills at run time (`instructionsTemplate`). "Start
// from the default" puts that template in the editor (never the filled text),
// so the admin's own text keeps the placeholders the engine fills, and a hint
// names the ones the template carries.
//
// The step is checked by this environment's engine as it is edited
// (POST …/plan-roles/check, debounced as the preparation steps are), and a
// refused save's `issues` are said the same way, each at its field. Neither
// holds Save: the server refuses a step the engine finds wrong.
//
// Where this environment's engine plans no roles (`supported` false, or no
// defaults), the switch still saves; the step is greyed out, with only taking
// back a saved value left choosable, as the preparation steps are.

import { useEffect, useId, useState } from "react"
import { getLlmModalityCaps } from "@nodaro/shared/llm-models"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  validationIssuesOf,
  type NodaroMotionPlanRoles,
  type NodaroMotionPlanRolesProblem,
  type NodaroMotionPlanRolesStep,
  type NodaroMotionPlanRolesView,
} from "@/lib/api"
import { useAdminLlmModels, type AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"
import { useNodaroMotionPlanRolesCheck, useNodaroMotionPlanRolesDefaults } from "@/ee/hooks/queries/use-nodaro-motion-plan-roles"
import { Problems } from "../../trends/components/LlmStepEditor"
import { STEPS_CHECK_DEBOUNCE_MS } from "../../trends/components/StepsEditor"

export const PLAN_ROLES_HEADING = "Roles from the prompt"

export const PLAN_ROLES_SWITCH_LABEL = "Offered"

/** The switch's hint: what it does, and this deployment's default. */
export function planRolesSwitchHint(enabledByDefault: boolean): string {
  return `People can describe what they want in their own words and add reference images, and the engine decides which subject of the video each image replaces. This deployment's default: ${enabledByDefault ? "on" : "off"}.`
}

/** Said where this environment's engine plans no roles. */
export const PLAN_ROLES_UNSUPPORTED = "This environment's engine does not plan roles from the prompt yet: nothing here is read until it does."

/** The one step. */
export const PLAN_ROLES_STEP = {
  title: "Planning step",
  hint: "Reads the person's request and their reference images, and says which subject of the video each image replaces.",
} as const

/** The placeholders a template carries (`<maxRoles>`; an older text may still carry `<maxPersons>`, which the engine goes on filling), each once, in the order they first appear. */
export function templatePlaceholders(template: string | undefined): string[] {
  return [...new Set(template?.match(/<max[A-Za-z0-9_]*>/g) ?? [])]
}

/** The step as saved: its instructions when not blank (as written), its model trimmed when not blank; undefined when neither. */
function stepToSaved(step: NodaroMotionPlanRolesStep | undefined): NodaroMotionPlanRolesStep | undefined {
  const out: NodaroMotionPlanRolesStep = {}
  if (typeof step?.instructions === "string" && step.instructions.trim() !== "") out.instructions = step.instructions
  if (typeof step?.model === "string" && step.model.trim() !== "") out.model = step.model.trim()
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The setting as it is saved (the server's own reading): `enabled` only when an admin chose a value, the step only when
 * it holds instructions or a model of the admin's own. A new object.
 */
export function planRolesToSaved(draft: NodaroMotionPlanRoles | null | undefined): NodaroMotionPlanRoles {
  const out: NodaroMotionPlanRoles = {}
  if (typeof draft?.enabled === "boolean") out.enabled = draft.enabled
  const plan = stepToSaved(draft?.plan)
  if (plan) out.plan = plan
  return out
}

/** The step alone, as the check takes it, as a string ("" when no step is set: nothing to check). */
function stepsKey(draft: NodaroMotionPlanRoles): string {
  const steps = planRolesToSaved(draft)
  delete steps.enabled
  return Object.keys(steps).length > 0 ? JSON.stringify(steps) : ""
}

/** The problems under `prefix`, their paths made relative to it ("" for one at `prefix` itself). */
function under(problems: readonly NodaroMotionPlanRolesProblem[], prefix: string): NodaroMotionPlanRolesProblem[] {
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
  readonly view: NodaroMotionPlanRolesView
  /** The draft, in its saved form (`enabled` left out: the deployment's default). */
  readonly value: NodaroMotionPlanRoles
  readonly onChange: (next: NodaroMotionPlanRoles) => void
  /** The last save's refusal: its `issues` said at their fields. */
  readonly saveError: unknown
}

export function PlanRolesSection({ view, value, onChange, saveError }: Props) {
  const id = useId()
  const switchId = `${id}-switch`
  const hintId = `${id}-hint`
  const defaultsQuery = useNodaroMotionPlanRolesDefaults(view.supported)
  const answer = view.supported && defaultsQuery.data ? defaultsQuery.data : undefined
  const defaults = answer?.defaults.plan
  const unsupported = !view.supported || defaultsQuery.data === null
  const [models, setModels] = useState<readonly AdminLlmModel[] | undefined>(undefined)

  const current = stepsKey(value)
  const settled = useSettled(current, STEPS_CHECK_DEBOUNCE_MS)
  const check = useNodaroMotionPlanRolesCheck(settled, !!defaults)
  // A refused save's fields first; else the check of the step as it stands now (never a former draft's).
  const saveIssues: NodaroMotionPlanRolesProblem[] = validationIssuesOf(saveError).map((i) => ({ ...i, code: i.code ?? "validation_error" }))
  const problems = saveIssues.length > 0 ? saveIssues : defaults && check.data && settled === current ? check.data : []
  const saveMessage = saveError instanceof Error && saveIssues.length === 0 ? saveError.message : undefined
  const rest = problems.filter((p) => !(p.path === "planRoles.plan" || p.path.startsWith("planRoles.plan.")))

  const checked = value.enabled ?? view.enabledByDefault
  const setEnabled = (next: boolean) => {
    const out: NodaroMotionPlanRoles = { ...value }
    // Stored only once an admin chose a value: back at the deployment's default with none saved, it stays left out.
    if (typeof view.planRoles?.enabled === "boolean" || next !== view.enabledByDefault) out.enabled = next
    else delete out.enabled
    onChange(out)
  }
  const setStep = (step: NodaroMotionPlanRolesStep | undefined) => {
    const out: NodaroMotionPlanRoles = { ...value }
    if (step) out.plan = step
    else delete out.plan
    onChange(out)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm" data-testid="plan-roles">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={switchId} className="font-medium">
            {PLAN_ROLES_SWITCH_LABEL}
          </Label>
          <p id={hintId} className="text-xs text-muted-foreground">
            {planRolesSwitchHint(view.enabledByDefault)}
          </p>
        </div>
        <Switch id={switchId} className="mt-0.5" checked={checked} onCheckedChange={setEnabled} aria-describedby={hintId} />
      </div>
      {unsupported ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {PLAN_ROLES_UNSUPPORTED}
        </p>
      ) : defaultsQuery.error ? (
        <p className="text-xs text-destructive">{defaultsQuery.error.message}</p>
      ) : !defaults ? (
        <p className="text-xs text-muted-foreground">Loading the engine's defaults…</p>
      ) : null}
      {defaults && <ModelsReader onModels={setModels} />}
      <StepEditor
        title={PLAN_ROLES_STEP.title}
        hint={PLAN_ROLES_STEP.hint}
        value={value.plan}
        defaults={defaults}
        template={answer?.instructionsTemplate}
        models={defaults ? models : undefined}
        problems={under(problems, "planRoles.plan")}
        onChange={setStep}
      />
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
  readonly value: NodaroMotionPlanRolesStep | undefined
  /** The engine's default for the step (unknown while loading, or where the engine plans no roles: greyed out). */
  readonly defaults: { model: string; instructions: string } | undefined
  /** The engine's default instructions with their placeholders (absent: nothing to start from). */
  readonly template: string | undefined
  readonly models: readonly AdminLlmModel[] | undefined
  /** The problems for this step, their paths relative to it ("instructions", "model"; "" for the step itself). */
  readonly problems: readonly NodaroMotionPlanRolesProblem[]
  readonly onChange: (next: NodaroMotionPlanRolesStep | undefined) => void
}

function StepEditor({ title, hint, value, defaults, template, models, problems, onChange }: StepProps) {
  const id = useId()
  const disabled = !defaults
  const set = (patch: Partial<NodaroMotionPlanRolesStep>) => {
    const next: NodaroMotionPlanRolesStep = { ...(value ?? {}), ...patch }
    if (next.instructions === undefined || next.instructions === "") delete next.instructions
    if (next.model === undefined || next.model === "") delete next.model
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }
  // The step is shown the person's reference images: only the models that take images are offered.
  const offered = (models ?? []).filter((m) => m.isEnabled && getLlmModalityCaps(m.id).image)
  const model = value?.model ?? ""
  const unlisted = model !== "" && !offered.some((m) => m.id === model)
  const at = (field: string) => problems.filter((p) => p.path === field || p.path.startsWith(`${field}.`))
  const others = problems.filter((p) => !["instructions", "model"].includes(p.path.split(".")[0] ?? ""))
  const placeholders = defaults ? templatePlaceholders(template) : []

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
        {defaults && <span className="text-xs text-muted-foreground">Only models that take pictures are offered: this step is shown the reference images.</span>}
        <Problems list={at("model")} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-instructions`} className="font-medium">
            <span className="sr-only">{title}:</span> Instructions
          </label>
          <div className="flex flex-wrap items-center gap-1">
            {defaults && template !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9"
                aria-label={`${title}: Start from the default`}
                disabled={value?.instructions === template}
                onClick={() => set({ instructions: template })}
              >
                Start from the default
              </Button>
            )}
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
        </div>
        <Textarea
          id={`${id}-instructions`}
          rows={8}
          value={value?.instructions ?? ""}
          placeholder={defaults?.instructions}
          disabled={disabled}
          aria-describedby={`${id}-instructions-hint`}
          onChange={(e) => set({ instructions: e.target.value })}
        />
        <span id={`${id}-instructions-hint`} className="text-xs text-muted-foreground">
          Empty: the engine's default (shown greyed out above).
          {placeholders.length > 0 &&
            ` Start from the default puts in its template: the engine fills ${placeholders.join(", ")} at run time, in its text and in yours.`}
        </span>
        <Problems list={at("instructions")} />
      </div>
      <Problems list={others} />
    </div>
  )
}
