"use client"

import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LlmModelSelect } from "./llm-model-select"

/**
 * Per-strategy config form for the Choose Best node (type id `reduce`).
 *
 * Strategy ids are declared in `@nodaro/shared/reduce-strategy-registry`.
 * Each branch here mirrors a strategy's `configSchema` field-by-field. When
 * the registry adds a new strategy or field, this switch is the local point
 * of change — the dispatching `ReduceConfig` stays untouched.
 */
/**
 * "The candidates are" — what the AI judge is handed. ONE list for the side
 * panel and the node's head-row chip (reduce-node.tsx), so the two cannot
 * drift. Values are the registry's `inputKind` enum. The description matters:
 * with image candidates left on Texts the judge compares the URL strings,
 * not the pictures — a meaningless pick that looks like a real one.
 */
export const REDUCE_INPUT_KIND_OPTIONS = [
  { value: "text", label: "Texts", description: "The AI reads each candidate as text" },
  { value: "image-url", label: "Images", description: "The AI looks at each candidate picture" },
] as const

export type ReduceInputKind = (typeof REDUCE_INPUT_KIND_OPTIONS)[number]["value"]

export const reduceInputKindLabel = (kind: string): string =>
  REDUCE_INPUT_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? REDUCE_INPUT_KIND_OPTIONS[0].label

type Props = {
  readonly strategyId: string
  readonly config: Record<string, unknown>
  readonly onChange: (cfg: Record<string, unknown>) => void
}

export function ReduceStrategyForms({ strategyId, config, onChange }: Props) {
  switch (strategyId) {
    case "pick-best-llm":
      return (
        <div className="flex flex-col gap-3">
          {/* The judge model — same selector every LLM node uses (tier badges,
              descriptions). Its tier drives the credit price: economy /
              standard / premium. Stored on strategyConfig.llmModel so the
              route, the estimator and the SDK all read one field. */}
          <LlmModelSelect
            feature="pick-best-llm"
            value={typeof config.llmModel === "string" ? config.llmModel : undefined}
            onChange={(llmModel) => onChange({ ...config, llmModel })}
          />
          <div className="flex flex-col gap-1.5">
            <Label>Judge by</Label>
            <Textarea
              value={String(config.criteria ?? "")}
              onChange={(e) => onChange({ ...config, criteria: e.target.value })}
              placeholder="e.g. 'The most eye-catching cover for a dark editorial Instagram feed — one clear focal point, readable as a thumbnail.'"
              rows={3}
            />
            <p className="text-[10px] text-muted-foreground">
              Describe what a winner looks like. The AI compares every candidate against this and picks one — its reasoning shows on the node and in the Candidates tab.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>The candidates are</Label>
            <Select
              value={String(config.inputKind ?? "text")}
              onValueChange={(v) => onChange({ ...config, inputKind: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REDUCE_INPUT_KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex flex-col gap-0.5">
                      <span>{o.label}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground/70">{o.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Also on the node, next to the model. Pick Images when the candidates are pictures — on Texts the AI would only compare their links.
            </p>
          </div>
        </div>
      )

    case "concat":
      return (
        <div className="flex flex-col gap-1.5">
          <Label>Separator</Label>
          <Input
            value={String(config.separator ?? "\n\n")}
            onChange={(e) => onChange({ ...config, separator: e.target.value })}
            placeholder="e.g. '\n\n' or ' • '"
          />
          <p className="text-[10px] text-muted-foreground">
            Placed between each candidate when they are joined into one text.
          </p>
        </div>
      )

    case "vote":
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(config.caseSensitive)}
            onCheckedChange={(v) => onChange({ ...config, caseSensitive: v })}
          />
          <Label className="cursor-pointer">Treat different letter case as different answers</Label>
        </div>
      )

    case "merge-json":
      return (
        <div className="flex flex-col gap-1.5">
          <Label>How to merge</Label>
          <Select
            value={String(config.strategy ?? "deep")}
            onValueChange={(v) => onChange({ ...config, strategy: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deep">Deep (nested objects too)</SelectItem>
              <SelectItem value="shallow">Shallow (top level only)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Deep merges nested objects field by field. Shallow replaces whole
            top-level fields, later candidates winning.
          </p>
        </div>
      )

    case "first-non-empty":
    case "count":
      return (
        <p className="text-xs text-muted-foreground">Nothing to configure.</p>
      )

    default:
      return null
  }
}
