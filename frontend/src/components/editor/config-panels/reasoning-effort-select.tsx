import { useT, tx } from "@/lib/i18n"
import { useEffect } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useLlmDirectCost } from "@/hooks/use-llm-price"
import { useLlmPricingMode, type LlmPricingMode } from "@/hooks/use-llm-pricing-mode"
import {
  availableReasoningEfforts,
  defaultReasoningEffort,
  getLlmModel,
  LLM_FEATURE_DEFAULTS,
  type LlmFeature,
  type LlmReasoningEffort
} from "@nodaro/shared/llm-models"

/** Shared across every reasoning-effort surface (this select + the llm-chat
 *  quick toolbar + the quick strip) so the wording can't drift between them.
 *
 *  `mode`: how the server prices LLM calls, as its price answers last said
 *  (`useLlmPricingMode()`). Metered: a higher effort costs the reasoning tokens
 *  it uses. Tier (the rollback): these two levels bump one tier. Unknown (no
 *  answer yet): the bare level, true in both modes. */
export function EFFORT_LABELS(mode: LlmPricingMode = "unknown"): Record<LlmReasoningEffort, string> {
  return {
  none: tx("cfgshared.effortNone"),
  low: tx("audiocfg.low"),
  medium: tx("cfgshared.effortMedium"),
  high: tx("audiocfg.high"),
  // Tier pricing ("may"): these two levels bump one tier for the effort itself. On a Claude
  // model the call ALSO runs direct (any effort does — see the hint below), and
  // the two bumps stack, as Advanced mode's always has; the stacking is pinned
  // in packages/shared's llm-models test ("the effort and direct bumps stack").
  // Metered: the call is charged the tokens it uses, so more reasoning costs more.
  xhigh: tx(mode === "metered" ? "cfgshared.effortVeryHighMetered" : mode === "tier" ? "cfgshared.effortVeryHigh" : "cfgshared.effortVeryHighPlain"),
  max: tx(mode === "metered" ? "cfgshared.effortMaxMetered" : mode === "tier" ? "cfgshared.effortMax" : "cfgshared.effortMaxPlain"),
}
}

/**
 * The mode a surface's labels and notes read: the server's last answer
 * (`useLlmPricingMode`) — which follows a mid-session rollback — and, until any
 * answer has said, this surface's own price answer (`metered` from its key's
 * estimate), else unknown.
 */
export function effortPricingMode(answered: LlmPricingMode, ownEstimate: boolean): LlmPricingMode {
  if (answered !== "unknown") return answered
  return ownEstimate ? "metered" : "unknown"
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
 *  → the vendor default. On a model with a recipe effort for the feature
 *  (`defaultReasoningEffort` — describe-to-picker's Opus 5.5 at high), an
 *  omitted effort runs at that recipe instead, so the picker shows it and
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

  // What an effort's direct run costs against the effort-free one, from the
  // server's two estimates (metered pricing; the tier-era note otherwise).
  // Called before the early return below (Rules of Hooks).
  const directCost = useLlmDirectCost(feature, effectiveModel, { reasoningEffort: value ?? levels[0], advancedMode: advanced === true })
  const pricingMode = effortPricingMode(useLlmPricingMode(), directCost.metered)
  if (levels.length === 0) return null
  // Claude's effort only takes effect on Anthropic's own API, so any level
  // runs there and bills one tier more (llmServesDirect) — say so where the
  // choice is made. Advanced on: the toggle's own hint already says it.
  const effortRunsDirect = !advanced && Boolean(getLlmModel(effectiveModel)?.effortRequiresDirect)
  // An unset effort shows the one the run uses: the model's recipe effort for
  // the feature (describe-to-picker's high on Opus 5.5), else Auto. Display
  // only — nothing is written until the user picks.
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
              {EFFORT_LABELS(pricingMode)[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {effortRunsDirect && (
        <p className="text-[11px] text-muted-foreground">
          {/* With a default effort there is no effort-free run to fall back
              on, so the usual hint ("choosing an effort runs it there")
              would imply one. */}
          {pricingMode !== "metered"
            ? t(featureDefault === undefined ? "cfgshared.effortRunsDirect" : "cfgshared.effortRunsDirectByDefault")
            : featureDefault !== undefined
              ? t("cfgshared.effortRunsDirectByDefaultMetered")
              : directCost.times !== undefined
                ? t("cfgshared.effortRunsDirectMetered", { n: directCost.times })
                : t("cfgshared.effortRunsDirectMeteredPlain")}
        </p>
      )}
    </div>
  )
}
