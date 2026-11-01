// One LLM step of a Nodaro Motion run's preparation (`LlmStepSetting`): the
// model that writes it, its instructions, what it is shown and the longest
// text it may write. Used by the labeller of the reference sheets and by the
// text steps (the engine prompt, the scene description).
//
// - Model: the admin LLM models list (enabled ones only). While the step is
//   shown a picture (the clip, the role pictures or the references), only the
//   models that take images are offered. A saved model that is no longer
//   offered stays shown as it is, marked, so the screen never says otherwise
//   than what is saved; the check names it.
// - Instructions: empty = the engine's default, shown as the placeholder and
//   never written into the setting; "Reset to default" empties it.
// - What it sees: not offered for the labeller (it reads the role pictures,
//   nothing else).
// - Length: 200–20,000 characters; the run caps it further.
//
// The defaults' texts are the engine's, read at run time: none is written here.

import { useId } from "react"
import { getLlmModalityCaps } from "@nodaro/shared/llm-models"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import type { CastSwapStepsProblem, LlmInput, LlmStepSetting } from "@/lib/api"
import type { AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"

/** The longest text a step may be set to write, and the shortest. */
export const LLM_MAX_CHARS = { min: 200, max: 20_000 } as const

/** What a step may be shown, in the order offered. */
export const LLM_INPUT_LABELS: ReadonlyArray<{ value: LlmInput; label: string }> = [
  { value: "clip", label: "The clip" },
  { value: "rolePhotos", label: "The role pictures" },
  { value: "references", label: "The fixed references" },
  { value: "extraPrompt", label: "The person's extra prompt" },
]

/** The inputs that are pictures: a model shown any of them must take images. */
const PICTURE_INPUTS: ReadonlySet<LlmInput> = new Set(["clip", "rolePhotos", "references"])

/** The labeller reads the role pictures and nothing else. */
export const LABELLER_INPUTS: LlmInput[] = ["rolePhotos"]

/** A step's setting seeded from the engine's default: its model, inputs and length (instructions left out = the default). */
export function seedLlm(defaults: LlmStepSetting): LlmStepSetting {
  return { model: defaults.model, inputs: [...defaults.inputs], maxChars: defaults.maxChars }
}

/** Whether the step is shown a picture. */
export function seesPictures(inputs: readonly LlmInput[]): boolean {
  return inputs.some((i) => PICTURE_INPUTS.has(i))
}

/** The models offered for a step: enabled ones, and only those that take images while it sees a picture. */
export function offeredModels(models: readonly AdminLlmModel[], inputs: readonly LlmInput[]): AdminLlmModel[] {
  const pictures = seesPictures(inputs)
  return models.filter((m) => m.isEnabled && (!pictures || getLlmModalityCaps(m.id).image))
}

interface Props {
  /** The step's setting; left out = the engine's default (shown, not written until edited). */
  readonly value: LlmStepSetting | undefined
  readonly onChange: (next: LlmStepSetting) => void
  /** The engine's default for this step (its instructions shown as the placeholder). */
  readonly defaults: LlmStepSetting & { instructions: string }
  /** The admin LLM models list (undefined while loading). */
  readonly models: readonly AdminLlmModel[] | undefined
  /** Offer "What it sees" (false for the labeller, whose input is fixed). */
  readonly showInputs: boolean
  /** Said under the length: how the run caps it further. */
  readonly lengthNote?: string
  /** The check's problems for this step, their paths relative to it ("model", "inputs", …). */
  readonly problems?: readonly CastSwapStepsProblem[]
  readonly disabled?: boolean
}

/** The problems whose relative path starts with `field`. */
const at = (problems: readonly CastSwapStepsProblem[], field: string) => problems.filter((p) => p.path === field || p.path.startsWith(`${field}.`))

export function LlmStepEditor({ value, onChange, defaults, models, showInputs, lengthNote, problems = [], disabled }: Props) {
  const id = useId()
  const current: LlmStepSetting = value ?? seedLlm(defaults)
  const inputs = showInputs ? current.inputs : LABELLER_INPUTS
  // Every write carries the whole setting; the labeller's inputs are always exactly the role pictures.
  const set = (patch: Partial<LlmStepSetting>) => {
    const next: LlmStepSetting = { ...current, ...patch }
    if (!showInputs) next.inputs = [...LABELLER_INPUTS]
    if (next.instructions === undefined || next.instructions.trim() === "") delete next.instructions
    onChange(next)
  }
  const offered = offeredModels(models ?? [], inputs)
  // A saved model is marked as not offered only once the list is in (never while it loads).
  const unlisted = !offered.some((m) => m.id === current.model)
  const marked = unlisted && models !== undefined
  const lengthOut = !Number.isInteger(current.maxChars) || current.maxChars < LLM_MAX_CHARS.min || current.maxChars > LLM_MAX_CHARS.max
  const known = new Set(["model", "instructions", "inputs", "maxChars"])
  const rest = problems.filter((p) => !known.has(p.path.split(".")[0] ?? ""))

  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1 sm:w-1/2 sm:pr-1.5">
        <label htmlFor={`${id}-model`} className="font-medium">
          Model
        </label>
        <select
          id={`${id}-model`}
          className="h-9 min-h-9 rounded-md border bg-background px-2 text-sm"
          value={current.model}
          disabled={disabled}
          onChange={(e) => set({ model: e.target.value })}
        >
          {unlisted && <option value={current.model}>{marked ? `${current.model} (not offered)` : current.model}</option>}
          {offered.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        {models === undefined && <span className="text-xs text-muted-foreground">Loading the models…</span>}
        {seesPictures(inputs) && <span className="text-xs text-muted-foreground">Only models that take pictures are offered: this step is shown pictures.</span>}
        <Problems list={at(problems, "model")} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-instructions`} className="font-medium">
            Instructions
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9"
            disabled={disabled || current.instructions === undefined}
            onClick={() => set({ instructions: undefined })}
          >
            Reset to default
          </Button>
        </div>
        <Textarea
          id={`${id}-instructions`}
          rows={6}
          value={current.instructions ?? ""}
          placeholder={defaults.instructions}
          disabled={disabled}
          aria-describedby={`${id}-instructions-hint`}
          onChange={(e) => set({ instructions: e.target.value })}
        />
        <span id={`${id}-instructions-hint`} className="text-xs text-muted-foreground">
          Empty: the engine's default (shown greyed out above).
        </span>
        <Problems list={at(problems, "instructions")} />
      </div>

      {showInputs && (
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">What it sees</legend>
          <div className="grid gap-x-3 sm:grid-cols-2">
            {LLM_INPUT_LABELS.map((input) => {
              const inputId = `${id}-input-${input.value}`
              const checked = current.inputs.includes(input.value)
              return (
                <div key={input.value} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(on) =>
                      set({
                        // Kept in the offered order, each once.
                        inputs: LLM_INPUT_LABELS.map((i) => i.value).filter((v) => (v === input.value ? on === true : current.inputs.includes(v))),
                      })
                    }
                  />
                  <label htmlFor={inputId}>{input.label}</label>
                </div>
              )
            })}
          </div>
          <Problems list={at(problems, "inputs")} />
        </fieldset>
      )}

      <div className="flex flex-col gap-1 sm:w-1/2 sm:pr-1.5">
        <label htmlFor={`${id}-length`} className="font-medium">
          Length (characters)
        </label>
        <input
          id={`${id}-length`}
          type="number"
          inputMode="numeric"
          min={LLM_MAX_CHARS.min}
          max={LLM_MAX_CHARS.max}
          step={1}
          className="h-9 min-h-9 rounded-md border bg-background px-2 text-sm"
          value={Number.isFinite(current.maxChars) ? current.maxChars : ""}
          disabled={disabled}
          aria-describedby={`${id}-length-hint`}
          aria-invalid={lengthOut || undefined}
          onChange={(e) => set({ maxChars: e.target.value === "" ? Number.NaN : Math.round(Number(e.target.value)) })}
        />
        <span id={`${id}-length-hint`} className="text-xs text-muted-foreground">
          The longest text it may write, 200 to 20,000 characters{lengthNote ? ` (${lengthNote})` : ""}.
        </span>
        {lengthOut && <span className="text-xs text-destructive">Choose 200 to 20,000 characters.</span>}
        <Problems list={at(problems, "maxChars")} />
      </div>
      <Problems list={rest} />
    </div>
  )
}

/** The check's problems, said where they apply. */
export function Problems({ list }: { readonly list: readonly CastSwapStepsProblem[] }) {
  if (list.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-destructive" aria-live="polite">
      {list.map((p, i) => (
        <li key={`${p.path}-${p.code}-${i}`}>{p.message}</li>
      ))}
    </ul>
  )
}
