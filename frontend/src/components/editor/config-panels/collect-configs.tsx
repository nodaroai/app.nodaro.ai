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
 *   • Inputs  — read-only summary of the most recent run (the merged result
 *               and the upstream branch count). Disabled until the node has
 *               completed at least once.
 *
 * The strategy registry lives in `@nodaro/shared/collect-strategy-registry`
 * — single source of truth for ids, labels, and default configs. Changing
 * a strategy snaps `strategyConfig` to that strategy's `defaultConfig`.
 */
export function CollectConfig({ data, onUpdate }: ConfigProps<CollectNodeData>) {
  const status = data.executionStatus ?? "idle"
  const hasResult = status === "completed" && typeof data.result === "string"
  const inputsTabEnabled = hasResult

  // Upstream branch count is set by the workflow executor on data.__upstreamCount
  // (see collect-node.tsx). It's only meaningful after a run.
  const upstreamCountRaw = (data as unknown as Record<string, unknown>).__upstreamCount
  const upstreamCount = typeof upstreamCountRaw === "number" ? upstreamCountRaw : undefined

  const strategy = COLLECT_STRATEGIES.find((s) => s.id === data.strategyId)
  const strategyLabel = strategy?.label ?? data.strategyId

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
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-medium text-muted-foreground">Strategy</Label>
              <p className="text-sm">{strategyLabel}</p>
            </div>
            {upstreamCount !== undefined && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-medium text-muted-foreground">
                  Upstream branches
                </Label>
                <p className="text-sm">
                  {upstreamCount} &rarr; 1
                </p>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-medium text-muted-foreground">Result</Label>
              <pre className="text-xs bg-muted/40 p-2 rounded whitespace-pre-wrap break-words max-h-64 overflow-auto">
                {data.result}
              </pre>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Run the workflow to inspect inputs.
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}
