"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { COLLECT_STRATEGIES } from "@nodaro/shared"
import type { CollectNodeData } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { CollectStrategyForms } from "./collect-strategy-forms"

/**
 * Config panel for the Collect (fan-in) node.
 *
 * Layout: two tabs.
 *   • Config  — strategy picker + per-strategy form.
 *   • Inputs  — per-iteration inspector for the most recent run: the meta
 *               summary, the LLM reasoning blockquote (when present), and a
 *               vertical list of every upstream item with `selectedIndex`
 *               highlighted in brand pink. Disabled until the node has
 *               completed at least once with persisted inputs.
 *
 * The strategy registry lives in `@nodaro/shared/collect-strategy-registry`
 * — single source of truth for ids, labels, and default configs. Changing
 * a strategy snaps `strategyConfig` to that strategy's `defaultConfig`.
 */
export function CollectConfig({ data, onUpdate }: ConfigProps<CollectNodeData>) {
  const status = data.executionStatus ?? "idle"
  const hasLastInputs = Array.isArray(data.lastInputs) && data.lastInputs.length > 0
  const inputsTabEnabled = status === "completed" && hasLastInputs

  const strategy = COLLECT_STRATEGIES.find((s) => s.id === data.strategyId)

  return (
    <Tabs defaultValue="config" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="config">Config</TabsTrigger>
        <TabsTrigger value="inputs" disabled={!inputsTabEnabled}>
          Inputs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="config" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Strategy</Label>
          <Select
            value={data.strategyId}
            onValueChange={(strategyId) => {
              const next = COLLECT_STRATEGIES.find((s) => s.id === strategyId)
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
              {COLLECT_STRATEGIES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {strategy?.description && (
            <p className="text-[10px] text-muted-foreground">{strategy.description}</p>
          )}
        </div>

        <CollectStrategyForms
          strategyId={data.strategyId}
          config={data.strategyConfig ?? {}}
          onChange={(cfg) => onUpdate({ strategyConfig: cfg })}
        />
      </TabsContent>

      <TabsContent value="inputs" className="flex flex-col gap-3">
        {inputsTabEnabled ? (
          <CollectInputsTab inputs={data.lastInputs ?? []} meta={data.lastMeta} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Run the workflow to inspect inputs.
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}

/** Per-iteration inspector. */
function CollectInputsTab({
  inputs,
  meta,
}: {
  inputs: readonly string[]
  meta: CollectNodeData["lastMeta"]
}) {
  const summary = meta?.summary ?? ""
  const reasoning = meta?.reasoning
  const selectedIndex = typeof meta?.selectedIndex === "number" ? meta.selectedIndex : undefined

  return (
    <>
      {summary && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground">Summary</Label>
          <p className="text-sm">{summary}</p>
        </div>
      )}

      {reasoning && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground">Reasoning</Label>
          <blockquote className="text-xs italic border-l-2 border-muted-foreground/40 pl-2 text-muted-foreground">
            {reasoning}
          </blockquote>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label className="text-xs font-medium text-muted-foreground">
          Items ({inputs.length})
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
                      selected
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
