// A trend's prompt style (hidden from users), under 4. Prompts: how the
// engine words the run's prompt — Precise or Flexible (prompt-style.ts). Left
// as it is, the clip preparation picks it (Flexible for Full depth, Precise
// otherwise), shown as "(default)". The engine prompt below follows it once
// the draft is saved.
//
// An environment whose Cast Swap engine does not declare the chosen style
// (`castSwap.promptStyles`) is named under the select: the trend can't be
// published there until it does. The preparation's default never needs it.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AdminTrendFaceMasking, CastSwapPromptStyleId, TrendEngineEnvironment } from "@/lib/api"
import { PROMPT_STYLES, defaultPromptStyleOf, environmentsLackingStyle } from "../prompt-style"

interface Props {
  /** As stored: undefined = the clip preparation's default. */
  readonly value: CastSwapPromptStyleId | undefined
  readonly onChange: (next: CastSwapPromptStyleId | undefined) => void
  /** The form's face masking (its clip preparation picks the default). */
  readonly faceMasking: AdminTrendFaceMasking | undefined
  readonly envs?: readonly TrendEngineEnvironment[]
  /** The label (Admin → Nodaro Motion names its own default). */
  readonly label?: string
  /** The default's name, when it is not the clip preparation's (Admin → Nodaro Motion: Flexible). */
  readonly defaultStyle?: CastSwapPromptStyleId
}

export function PromptStyleSelect({ value, onChange, faceMasking, envs, label = "Prompt style", defaultStyle }: Props) {
  const id = useId()
  const fallback = defaultStyle ?? defaultPromptStyleOf(faceMasking)
  const shown = value ?? fallback
  const hint = PROMPT_STYLES.find((s) => s.value === shown)?.hint
  const lacking = defaultStyle ? [] : environmentsLackingStyle(shown, faceMasking, envs)
  return (
    <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <Select
        value={shown}
        // Choosing the default stores no key, so a draft that leaves it to the clip preparation follows it.
        onValueChange={(v) => onChange(v === fallback ? undefined : (v as CastSwapPromptStyleId))}
      >
        <SelectTrigger id={id} className="h-9" aria-describedby={`${id}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROMPT_STYLES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
              {s.value === fallback ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </span>
      {lacking.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Not supported yet by the Cast Swap engine of: {lacking.join(", ")}. The trend can't be published until it is.
        </span>
      )}
    </div>
  )
}
