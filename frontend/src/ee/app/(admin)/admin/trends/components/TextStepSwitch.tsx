// A text step of a Nodaro Motion run's preparation (`TextStepSetting`): the
// engine prompt, or the Full depth scene description. Template (the engine's
// own wording, today's run) or LLM (a model writes it, LlmStepEditor.tsx).
//
// Template removes the step from the setting (left out = the template), so a
// setting that only names the template is saved exactly as one that names
// nothing. LLM seeds the engine's default model, inputs and length, with the
// instructions left empty (= the default).
//
// Greyed out (`disabled`: an environment's engine cannot take the steps), LLM
// can't be chosen; Template stays choosable while the step is LLM, so the
// admin can still remove it.

import { useId } from "react"
import type { CastSwapStepsProblem, LlmStepSetting, TextStepSetting } from "@/lib/api"
import type { AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"
import { LlmStepEditor, seedLlm } from "./LlmStepEditor"

interface Props {
  /** The step's name, for the choice's label ("Engine prompt"). */
  readonly label: string
  /** The step; left out = the template. */
  readonly value: TextStepSetting | undefined
  /** The next step; undefined = removed (the template). */
  readonly onChange: (next: TextStepSetting | undefined) => void
  /** The engine's default for the step's LLM (unknown while loading, or with no defaults: LLM can't be chosen). */
  readonly defaults: (LlmStepSetting & { instructions: string }) | undefined
  readonly models: readonly AdminLlmModel[] | undefined
  /** Said under the LLM's length: how the run caps it further. */
  readonly lengthNote?: string
  /** The check's problems for this step, their paths relative to its LLM ("model", "inputs", …). */
  readonly problems?: readonly CastSwapStepsProblem[]
  readonly disabled?: boolean
}

export function TextStepSwitch({ label, value, onChange, defaults, models, lengthNote, problems, disabled }: Props) {
  const id = useId()
  const llm = value?.mode === "llm"
  const options: ReadonlyArray<{ value: "template" | "llm"; label: string; hint: string; off: boolean }> = [
    { value: "template", label: "Template", hint: "The engine's own wording (as today).", off: !!disabled && !llm },
    { value: "llm", label: "LLM", hint: "A model writes it, from what it is shown.", off: !!disabled || !defaults },
  ]
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="sr-only">{label}</legend>
        <div className="flex flex-wrap gap-x-4">
          {options.map((o) => {
            const optionId = `${id}-${o.value}`
            return (
              <div key={o.value} className="flex min-h-11 items-center gap-2">
                <input
                  id={optionId}
                  type="radio"
                  name={`${id}-mode`}
                  className="h-4 w-4"
                  checked={o.value === "llm" ? llm : !llm}
                  disabled={o.off}
                  aria-describedby={`${optionId}-hint`}
                  onChange={() => {
                    if (o.value === "template") onChange(undefined)
                    else if (defaults) onChange({ mode: "llm", llm: seedLlm(defaults) })
                  }}
                />
                <label htmlFor={optionId} className="font-medium">
                  {o.label}
                </label>
                <span id={`${optionId}-hint`} className="sr-only">
                  {o.hint}
                </span>
              </div>
            )
          })}
        </div>
        <span className="text-xs text-muted-foreground">{llm ? options[1]!.hint : options[0]!.hint}</span>
      </fieldset>
      {value?.mode === "llm" && !defaults && <p className="text-xs text-muted-foreground">Written by an LLM ({value.llm.model}).</p>}
      {value?.mode === "llm" && defaults && (
        <LlmStepEditor
          value={value.llm}
          defaults={defaults}
          models={models}
          showInputs
          lengthNote={lengthNote}
          problems={problems}
          disabled={disabled}
          onChange={(next) => onChange({ mode: "llm", llm: next })}
        />
      )}
    </div>
  )
}
