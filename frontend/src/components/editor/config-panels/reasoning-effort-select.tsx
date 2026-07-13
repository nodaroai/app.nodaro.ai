import { useEffect } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getLlmModel, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { LlmFeature, LlmReasoningEffort } from "@nodaro/shared"

/** Shared across every reasoning-effort surface (this select + the llm-chat
 *  quick toolbar) so the wording can't drift between them. */
export const EFFORT_LABELS: Record<LlmReasoningEffort, string> = {
  none: "None — no reasoning",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high (may bill one tier up)",
  max: "Max (may bill one tier up)",
}
const AUTO = "__auto__"

interface ReasoningEffortSelectProps {
  feature: LlmFeature
  /** The node's current llmModel (undefined = the feature default). */
  modelId?: string
  value?: LlmReasoningEffort
  onChange: (value: LlmReasoningEffort | undefined) => void
}

/** Effort picker for reasoning-capable models. Renders nothing when the
 *  active model declares no levels; clears a stale value on model switch
 *  (Provider Enum Sync pitfall 12b). "Auto" sends nothing → vendor default. */
export function ReasoningEffortSelect({ feature, modelId, value, onChange }: ReasoningEffortSelectProps) {
  const effectiveModel = modelId || LLM_FEATURE_DEFAULTS[feature]
  const levels = getLlmModel(effectiveModel)?.reasoningEfforts ?? []

  useEffect(() => {
    if (value && !levels.includes(value)) onChange(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveModel])

  if (levels.length === 0) return null

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">Reasoning Effort</label>
      <Select
        value={value ?? AUTO}
        onValueChange={(v) => onChange(v === AUTO ? undefined : (v as LlmReasoningEffort))}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO} className="text-xs">Auto (model default)</SelectItem>
          {levels.map((level) => (
            <SelectItem key={level} value={level} className="text-xs">
              {EFFORT_LABELS[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
