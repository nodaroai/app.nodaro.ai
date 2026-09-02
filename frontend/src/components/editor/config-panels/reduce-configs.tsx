"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { REDUCE_STRATEGIES, buildLlmCreditIdentifier } from "@nodaro/shared"
import type { ReduceNodeData } from "@/types/nodes"
import { useT } from "@/lib/i18n"
import type { ConfigProps } from "./types"
import { ReduceStrategyForms } from "./reduce-strategy-forms"
import { ModelSelectOption } from "./model-select-option"

/**
 * Config panel for the Choose Best node (type id `reduce`).
 *
 * Layout: two tabs.
 *   • Config      — "what to do with the candidates" picker (one row per
 *                   strategy: label, plain-language description, credit badge
 *                   from the strategy's creditCostKey — the AI judge is priced
 *                   by its chosen model's tier, the rest are free) + the
 *                   per-strategy form.
 *   • Candidates  — inspector for the most recent run: the summary, the
 *                   judge's reasoning (when present), and every candidate
 *                   with the chosen one highlighted in brand pink. Disabled
 *                   until the node has completed at least once with
 *                   persisted inputs.
 *
 * The strategy registry lives in `@nodaro/shared/reduce-strategy-registry`
 * — single source of truth for ids, labels, descriptions and default configs.
 * Changing a strategy snaps `strategyConfig` to that strategy's
 * `defaultConfig`.
 */
export function ReduceConfig({ data, onUpdate }: ConfigProps<ReduceNodeData>) {
  const t = useT()
  const status = data.executionStatus ?? "idle"
  const hasLastInputs = Array.isArray(data.lastInputs) && data.lastInputs.length > 0
  const inputsTabEnabled = status === "completed" && hasLastInputs

  const strategy = REDUCE_STRATEGIES.find((s) => s.id === data.strategyId)
  // The AI judge's price follows the chosen model's tier; the option row
  // shows the price for the model currently picked on this node.
  const judgeModel = typeof data.strategyConfig?.llmModel === "string" ? data.strategyConfig.llmModel : undefined

  return (
    <Tabs defaultValue="config" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="config">{t("cfgext.reduceTabConfig")}</TabsTrigger>
        <TabsTrigger value="inputs" disabled={!inputsTabEnabled}>
          {t("cfgext.reduceTabCandidates")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="config" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("cfgext.reduceWhatToDo")}</Label>
          <Select
            value={data.strategyId}
            onValueChange={(strategyId) => {
              const next = REDUCE_STRATEGIES.find((s) => s.id === strategyId)
              // Snap config to the new strategy's defaults — keeps the per-form
              // contract clean (no stale fields from the prior strategy).
              onUpdate({
                strategyId,
                strategyConfig: (next?.defaultConfig as Record<string, unknown>) ?? {},
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REDUCE_STRATEGIES.map((s) => (
                <ModelSelectOption
                  key={s.id}
                  value={s.id}
                  label={s.label}
                  desc={s.description}
                  creditId={
                    s.id === "pick-best-llm"
                      ? buildLlmCreditIdentifier(s.creditCostKey, judgeModel)
                      : s.creditCostKey
                  }
                />
              ))}
            </SelectContent>
          </Select>
          {strategy?.description && (
            <p className="text-[10px] text-muted-foreground">{strategy.description}</p>
          )}
        </div>

        <ReduceStrategyForms
          strategyId={data.strategyId}
          config={data.strategyConfig ?? {}}
          onChange={(cfg) => onUpdate({ strategyConfig: cfg })}
        />
      </TabsContent>

      <TabsContent value="inputs" className="flex flex-col gap-3">
        {inputsTabEnabled ? (
          <ReduceInputsTab inputs={data.lastInputs ?? []} meta={data.lastMeta} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("cfgext.reduceRunToSee")}
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}

/** Candidates inspector for the most recent run. */
function ReduceInputsTab({
  inputs,
  meta,
}: {
  inputs: readonly string[]
  meta: ReduceNodeData["lastMeta"]
}) {
  const t = useT()
  const summary = meta?.summary ?? ""
  const reasoning = meta?.reasoning
  const selectedIndex = typeof meta?.selectedIndex === "number" ? meta.selectedIndex : undefined

  return (
    <>
      {summary && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground">{t("cfgext.reduceSummary")}</Label>
          <p className="text-sm">{summary}</p>
        </div>
      )}

      {reasoning && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground">{t("cfgext.reduceWhyChosen")}</Label>
          <blockquote className="text-xs italic border-s-2 border-muted-foreground/40 ps-2 text-muted-foreground">
            {reasoning}
          </blockquote>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label className="text-xs font-medium text-muted-foreground">
          {t("cfgext.reduceCandidatesCount", { n: inputs.length })}
        </Label>
        <ul className="flex flex-col gap-1.5">
          {inputs.map((item, i) => {
            const isSelected = selectedIndex === i
            const truncated = item.length > 80 ? item.slice(0, 80) + "…" : item
            return (
              <li
                key={i}
                data-selected={isSelected ? "" : undefined}
                className={
                  "rounded text-xs px-2 py-1.5 break-words " +
                  (isSelected
                    ? "ring-2 ring-[#ff0073] bg-[#ff0073]/5"
                    : "bg-muted/40")
                }
              >
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground font-mono shrink-0">[{i}]</span>
                  <span className="flex-1 min-w-0">{truncated}</span>
                  {isSelected && (
                    <span className="shrink-0 text-[10px] uppercase font-medium tracking-wide text-[#ff0073]">
                      {t("cfgext.reduceChosen")}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
