// The Flex prompt wording control: "Current" (the default) or "New". Shared
// by a trend's 4. Prompts (`TrendVersionData.promptWording`) and Admin →
// Nodaro Motion's engine prompt, per engine (`nodaro_motion_prompt_wording`).
// Read only by the Flexible prompt: a Precise prompt ignores it.
//
// "New" is greyed out with the reason while it is not offered (a trend: no
// environment's engine words it yet; the shared setting: some environment's
// engine does not), unless it is already chosen, so a stored "new" can be
// seen and taken back.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CastSwapPromptWordingId } from "@/lib/api"
import { PROMPT_WORDINGS } from "../prompt-wording"

interface Props {
  /** As stored: undefined = "current". */
  readonly value: CastSwapPromptWordingId | undefined
  readonly onChange: (next: CastSwapPromptWordingId) => void
  /** Whether "New" may be chosen. */
  readonly newOffered: boolean
  /** Why "New" is greyed out (shown beside it). */
  readonly unofferedReason?: string
  /** A line under the select (the direct-run setting's reach). */
  readonly note?: string
  /** A warning under it (a trend: the environments it can't be published to). */
  readonly warning?: string
  readonly disabled?: boolean
}

export function PromptWordingSelect({ value, onChange, newOffered, unofferedReason, note, warning, disabled = false }: Props) {
  const id = useId()
  const shown = value ?? "current"
  const hint = PROMPT_WORDINGS.find((w) => w.value === shown)?.hint
  return (
    <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5" data-prompt-wording>
      <label htmlFor={id} className="font-medium">
        Wording
      </label>
      <Select value={shown} disabled={disabled} onValueChange={(v) => onChange(v as CastSwapPromptWordingId)}>
        <SelectTrigger id={id} className="h-9" aria-describedby={`${id}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROMPT_WORDINGS.map((w) => {
            const off = w.value === "new" && !newOffered && shown !== "new"
            return (
              <SelectItem key={w.value} value={w.value} disabled={off}>
                {w.label}
                {w.value === "current" ? " (default)" : ""}
                {off && unofferedReason ? ` (${unofferedReason})` : ""}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint} Only the Flexible prompt reads it; Precise is never changed.
      </span>
      {note && (
        <span className="text-xs font-medium text-muted-foreground" data-prompt-wording-note>
          {note}
        </span>
      )}
      {warning && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {warning}
        </span>
      )}
    </div>
  )
}
