import { useT, tx } from "@/lib/i18n"
import { useEffect } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { availableReasoningEfforts, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { LlmFeature, LlmReasoningEffort } from "@nodaro/shared"

/** Shared across every reasoning-effort surface (this select + the llm-chat
 *  quick toolbar) so the wording can't drift between them. */
export function EFFORT_LABELS(): Record<LlmReasoningEffort, string> {
  return {
  none: tx("cfgshared.effortNone"),
  low: tx("audiocfg.low"),
  medium: tx("cfgshared.effortMedium"),
  high: tx("audiocfg.high"),
  // Still accurate alongside Advanced mode: xhigh/max only exist on models
  // that have no direct lane (Claude/GPT), and Advanced only exists on Gemini,
  // so the effort bump and the advanced bump can never both apply to one call.
  // That is not a note to remember — it's pinned by "no advanced-capable model
  // declares xhigh/max" in packages/shared's llm-models test, which goes red if
  // the two bumps ever become stackable and this wording needs to change.
  xhigh: tx("cfgshared.effortVeryHigh"),
  max: tx("cfgshared.effortMax"),
}
}
const AUTO = "__auto__"

interface ReasoningEffortSelectProps {
  feature: LlmFeature
  /** The node's current llmModel (undefined = the feature default). */
  modelId?: string
  /** Advanced mode is on for this node. The vendor's own API accepts a wider
   *  effort ladder than the aggregator does, so the selectable levels — and
   *  therefore whether this picker renders at all — depend on it. */
  advanced?: boolean
  value?: LlmReasoningEffort
  onChange: (value: LlmReasoningEffort | undefined) => void
}

/** Effort picker for reasoning-capable models. Renders nothing when the
 *  active model declares no levels on the active lane; clears a stale value on
 *  model OR lane switch (Provider Enum Sync pitfall 12b). "Auto" sends nothing
 *  → vendor default. */
export function ReasoningEffortSelect({ feature, modelId, advanced, value, onChange }: ReasoningEffortSelectProps) {
  const t = useT()
  const effectiveModel = modelId || LLM_FEATURE_DEFAULTS[feature]
  const levels = availableReasoningEfforts(effectiveModel, advanced)

  // Lane is in the deps because turning Advanced OFF can narrow the ladder —
  // e.g. a `medium` picked on the direct lane is not a level KIE accepts, and
  // leaving it set would have the route clamp it silently.
  useEffect(() => {
    if (value && !levels.includes(value)) onChange(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveModel, advanced])

  if (levels.length === 0) return null

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{t("cfgshared.reasoningEffort")}</label>
      <Select
        value={value ?? AUTO}
        onValueChange={(v) => onChange(v === AUTO ? undefined : (v as LlmReasoningEffort))}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO} className="text-xs">{t("cfgshared.effortAutoModelDefault")}</SelectItem>
          {levels.map((level) => (
            <SelectItem key={level} value={level} className="text-xs">
              {EFFORT_LABELS()[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
