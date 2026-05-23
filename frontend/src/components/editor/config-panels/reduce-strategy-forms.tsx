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

/**
 * Per-strategy config form for the Reduce (fan-in) node.
 *
 * Strategy ids are declared in `@nodaro/shared/reduce-strategy-registry`.
 * Each branch here mirrors a strategy's `configSchema` field-by-field. When
 * the registry adds a new strategy or field, this switch is the local point
 * of change — the dispatching `ReduceConfig` stays untouched.
 */
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
          <div className="flex flex-col gap-1.5">
            <Label>Criteria</Label>
            <Textarea
              value={String(config.criteria ?? "")}
              onChange={(e) => onChange({ ...config, criteria: e.target.value })}
              placeholder="e.g. 'Pick the sharpest image with no artifacts.'"
              rows={3}
            />
            <p className="text-[10px] text-muted-foreground">
              Sonnet picks the best survivor against this rubric.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Input kind</Label>
            <Select
              value={String(config.inputKind ?? "text")}
              onValueChange={(v) => onChange({ ...config, inputKind: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="image-url">Image URL</SelectItem>
              </SelectContent>
            </Select>
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
            Joins all survivors with this string between each.
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
          <Label className="cursor-pointer">Case-sensitive</Label>
        </div>
      )

    case "merge-json":
      return (
        <div className="flex flex-col gap-1.5">
          <Label>Merge strategy</Label>
          <Select
            value={String(config.strategy ?? "deep")}
            onValueChange={(v) => onChange({ ...config, strategy: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deep">Deep merge</SelectItem>
              <SelectItem value="shallow">Shallow merge</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Deep merges nested objects recursively. Shallow overwrites at the
            top level only.
          </p>
        </div>
      )

    case "first-non-empty":
    case "count":
      return (
        <p className="text-xs text-muted-foreground">No configuration.</p>
      )

    default:
      return null
  }
}
