import { useT, tx } from "@/lib/i18n"
import { useEffect } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { availableReasoningEfforts, defaultReasoningEffort, getLlmModel, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { LlmFeature, LlmReasoningEffort } from "@nodaro/shared"

/** Shared across every reasoning-effort surface (this select + the llm-chat
 *  quick toolbar) so the wording can't drift between them. */
export function EFFORT_LABELS(): Record<LlmReasoningEffort, string> {
  return {
  none: tx("cfgshared.effortNone"),
  low: tx("audiocfg.low"),
  medium: tx("cfgshared.effortMedium"),
  high: tx("audiocfg.high"),
  // "May": these two levels bump one tier for the effort itself. On a Claude
  // model the call ALSO runs direct (any effort does — see the hint below), and
  // the two bumps stack, as Advanced mode's always has; the stacking is pinned
  // in packages/shared's llm-models test ("the effort and direct bumps stack").
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
 *  → the vendor default. On a feature's default model that has a default
 *  effort (`defaultReasoningEffort` — describe-to-picker's Opus 5.5 at high),
 *  an omitted effort runs at that default instead, so the picker shows it and
 *  offers no Auto, which would only be a second name for it (decided
 *  2026-10-09). */
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
  // Claude's effort only takes effect on Anthropic's own API, so any level
  // runs there and bills one tier more (llmServesDirect) — say so where the
  // choice is made. Advanced on: the toggle's own hint already says it.
  const effortRunsDirect = !advanced && Boolean(getLlmModel(effectiveModel)?.effortRequiresDirect)
  // An unset effort shows the one the run uses: the feature's default on its
  // default model (describe-to-picker's high), else Auto. Display only —
  // nothing is written until the user picks.
  const featureDefault = defaultReasoningEffort(feature, modelId)
  const shown = value ?? featureDefault ?? AUTO

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{t("cfgshared.reasoningEffort")}</label>
      <Select
        value={shown}
        onValueChange={(v) => onChange(v === AUTO ? undefined : (v as LlmReasoningEffort))}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {featureDefault === undefined && (
            <SelectItem value={AUTO} className="text-xs">{t("cfgshared.effortAutoModelDefault")}</SelectItem>
          )}
          {levels.map((level) => (
            <SelectItem key={level} value={level} className="text-xs">
              {EFFORT_LABELS()[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {effortRunsDirect && (
        <p className="text-[11px] text-muted-foreground">
          {/* With a default effort there is no effort-free run to fall back
              on, so the usual hint ("choosing an effort runs it there")
              would imply one. */}
          {t(featureDefault === undefined ? "cfgshared.effortRunsDirect" : "cfgshared.effortRunsDirectByDefault")}
        </p>
      )}
    </div>
  )
}
