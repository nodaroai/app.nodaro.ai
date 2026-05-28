"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SelectorNodeData } from "@/types/nodes"
import {
  parseListExpression,
  type FullSelectorMode,
  type SelectorConfig as SelectorConfigShape,
  type SelectorPredicateOp,
} from "@nodaro/shared"
import type { ConfigProps } from "./types"

const PREDICATE_OPS: { value: SelectorPredicateOp; label: string }[] = [
  { value: "=", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: ">", label: "greater than" },
  { value: "<", label: "less than" },
  { value: ">=", label: "greater or equal" },
  { value: "<=", label: "less or equal" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "regex", label: "matches regex" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "does not exist" },
]

const PREDICATE_NO_VALUE: ReadonlySet<SelectorPredicateOp> = new Set(["exists", "not_exists"])

const MODES: { value: FullSelectorMode; label: string }[] = [
  { value: "item", label: "Item (single index)" },
  { value: "range", label: "Range (from/to/step)" },
  { value: "list", label: "List (comma expression)" },
  { value: "random", label: "Random (seeded)" },
  { value: "modulo", label: "Modulo (cycle by index)" },
  { value: "predicate", label: "Predicate (filter)" },
  { value: "named-key", label: "Named key (look up)" },
]

export function SelectorConfig({ data, onUpdate }: ConfigProps<SelectorNodeData>) {
  const config: SelectorConfigShape = data.config ?? { mode: "item" }
  const mode = config.mode ?? "item"

  const pickedTotal = data.__pickedTotal ?? data.pickedResults?.length ?? 0
  const restTotal = data.__restTotal ?? data.restResults?.length ?? 0
  const hasRun = data.executionStatus === "completed"
  const errorMessage = data.errorMessage

  const updateMode = (next: FullSelectorMode) => {
    onUpdate({ config: { ...config, mode: next } })
  }
  const updateConfig = (patch: Partial<SelectorConfigShape>) => {
    onUpdate({ config: { ...config, ...patch } })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Mode</Label>
        <Select value={mode} onValueChange={(v) => updateMode(v as FullSelectorMode)}>
          <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODES.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Pick items by index, range, list, random sample, modulo cycle, predicate, or named key.
          Per-mode fields appear here once configured.
        </p>
      </div>

      {mode === "item" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="selector-item-index">Index</Label>
          <Input
            id="selector-item-index"
            placeholder="3, last, last-1"
            value={config.itemIndex ?? ""}
            onChange={(e) => updateConfig({ itemIndex: e.target.value || undefined })}
          />
          <p className="text-[10px] text-muted-foreground">
            1-based. Supports <code>last</code> and <code>last-N</code> relative expressions.
          </p>
        </div>
      )}

      {mode === "range" && (
        <RangeFields
          from={config.rangeFrom ?? ""}
          to={config.rangeTo ?? ""}
          step={config.rangeStep}
          onChange={updateConfig}
        />
      )}

      {mode === "list" && (
        <ListExpressionField
          value={config.listExpression ?? ""}
          onChange={(v) => updateConfig({ listExpression: v || undefined })}
        />
      )}

      {mode === "random" && (
        <RandomFields
          seed={config.seed ?? ""}
          count={config.randomCount}
          onChange={updateConfig}
        />
      )}

      {mode === "modulo" && (
        <ModuloFields
          divisor={config.moduloDivisor ?? ""}
          onChange={updateConfig}
        />
      )}

      {mode === "predicate" && (
        <PredicateFields
          field={config.predicateField ?? ""}
          op={config.predicateOp ?? "="}
          value={config.predicateValue ?? ""}
          match={config.predicateMatch ?? "first"}
          caseSensitive={config.predicateCaseSensitive ?? false}
          onChange={updateConfig}
        />
      )}

      {mode === "named-key" && (
        <NamedKeyFields
          field={config.namedKeyField ?? ""}
          value={config.namedKeyValue ?? ""}
          onChange={updateConfig}
        />
      )}

      {errorMessage ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="text-[11px] font-medium text-destructive">Error</p>
          <p className="text-[10px] text-destructive/90 break-all mt-0.5">{errorMessage}</p>
        </div>
      ) : hasRun ? (
        <div className="rounded-md bg-muted/30 px-3 py-2 border border-border">
          <Label className="text-[11px]">Last run</Label>
          <p className="text-xs text-foreground/80 mt-0.5">
            {pickedTotal} picked · {restTotal} rest
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
          Run the node to see picked / rest counts here.
        </p>
      )}
    </div>
  )
}

// NOTE: The edge selector (animated-flow-edge.tsx) has equivalent UI for
// range/list inputs using dark-theme inline styles. We deliberately keep a
// shadcn-styled copy here rather than extracting a shared component, because
// the two surfaces have different visual languages (dark edge overlay vs
// neutral config-panel sheet). If the styling ever converges, factor these
// into frontend/src/components/editor/selector-fields/.

function RangeFields({
  from,
  to,
  step,
  onChange,
}: {
  from: string
  to: string
  step: number | undefined
  onChange: (patch: Partial<SelectorConfigShape>) => void
}) {
  const handleStep = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === "") {
      onChange({ rangeStep: undefined })
      return
    }
    const num = parseInt(trimmed, 10)
    onChange({ rangeStep: isNaN(num) ? undefined : num })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Range</Label>
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">From</span>
          <Input
            placeholder="1"
            value={from}
            onChange={(e) => onChange({ rangeFrom: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
          <Input
            placeholder="last"
            value={to}
            onChange={(e) => onChange({ rangeTo: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Step</span>
          <Input
            inputMode="numeric"
            placeholder="1"
            value={step != null ? String(step) : ""}
            onChange={(e) => handleStep(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Both bounds are inclusive and 1-based. Step <code>{"<"} 0</code> iterates backwards (set From {">"} To).
      </p>
    </div>
  )
}

function ListExpressionField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const validation = parseListExpression(value)
  const isInvalid = value.trim() !== "" && !validation.ok
  const error = !validation.ok ? (validation as { ok: false; error: string }).error : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="selector-list-expression">Expression</Label>
      <Input
        id="selector-list-expression"
        placeholder="1, 2, last"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={isInvalid || undefined}
        className={isInvalid ? "border-destructive focus-visible:ring-destructive/40" : undefined}
      />
      {isInvalid && error ? (
        <p className="text-[10px] text-destructive">{error}</p>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Examples: <code>1, 2, last</code> · <code>1..5</code> · <code>1..10:2</code> · <code>1..last-1</code>
        </p>
      )}
    </div>
  )
}

function RandomFields({
  seed,
  count,
  onChange,
}: {
  seed: string
  count: number | undefined
  onChange: (patch: Partial<SelectorConfigShape>) => void
}) {
  const handleCount = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === "") {
      onChange({ randomCount: undefined })
      return
    }
    const n = parseInt(trimmed, 10)
    onChange({ randomCount: isNaN(n) ? undefined : Math.max(1, n) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="selector-random-seed">Seed (optional)</Label>
        <Input
          id="selector-random-seed"
          placeholder="leave empty for fresh randomness each run"
          value={seed}
          onChange={(e) => onChange({ seed: e.target.value || undefined })}
        />
        <p className="text-[10px] text-muted-foreground">
          Supports <code>{"{NodeLabel}"}</code> refs. Same seed + same input list → same pick.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="selector-random-count">Count</Label>
        <Input
          id="selector-random-count"
          inputMode="numeric"
          placeholder="1"
          value={count != null ? String(count) : ""}
          onChange={(e) => handleCount(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">
          Number of items to sample without replacement. Defaults to 1.
        </p>
      </div>
    </div>
  )
}

function ModuloFields({
  divisor,
  onChange,
}: {
  divisor: string
  onChange: (patch: Partial<SelectorConfigShape>) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="selector-modulo-divisor">Divisor</Label>
      <Input
        id="selector-modulo-divisor"
        placeholder="5 or {LoopIteration}"
        value={divisor}
        onChange={(e) => onChange({ moduloDivisor: e.target.value || undefined })}
      />
      <p className="text-[10px] text-muted-foreground">
        Literal integer or <code>{"{NodeLabel}"}</code> reference. Picks index = divisor % length.
      </p>
    </div>
  )
}

function PredicateFields({
  field,
  op,
  value,
  match,
  caseSensitive,
  onChange,
}: {
  field: string
  op: SelectorPredicateOp
  value: string
  match: "first" | "all"
  caseSensitive: boolean
  onChange: (patch: Partial<SelectorConfigShape>) => void
}) {
  const noValue = PREDICATE_NO_VALUE.has(op)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_140px] gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="selector-pred-field" className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Field
          </Label>
          <Input
            id="selector-pred-field"
            placeholder="score (blank = whole item)"
            value={field}
            onChange={(e) => onChange({ predicateField: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="selector-pred-op" className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operator
          </Label>
          <Select
            value={op}
            onValueChange={(v) =>
              onChange({
                predicateOp: v as SelectorPredicateOp,
                predicateValue: PREDICATE_NO_VALUE.has(v as SelectorPredicateOp) ? undefined : value || undefined,
              })
            }
          >
            <SelectTrigger id="selector-pred-op" aria-label="Operator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PREDICATE_OPS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!noValue && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="selector-pred-value">Value</Label>
          <Input
            id="selector-pred-value"
            placeholder="threshold or {NodeLabel}"
            value={value}
            onChange={(e) => onChange({ predicateValue: e.target.value || undefined })}
          />
          <p className="text-[10px] text-muted-foreground">
            Supports <code>{"{NodeLabel}"}</code> refs. Reuses filter-list evaluator semantics.
          </p>
        </div>
      )}
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <Label className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Match
          </Label>
          <RadioGroup
            value={match}
            onValueChange={(v) => onChange({ predicateMatch: v as "first" | "all" })}
            className="flex gap-3"
            aria-label="Match"
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem id="selector-pred-match-first" value="first" />
              <Label htmlFor="selector-pred-match-first" className="text-xs font-normal">
                First
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem id="selector-pred-match-all" value="all" />
              <Label htmlFor="selector-pred-match-all" className="text-xs font-normal">
                All
              </Label>
            </div>
          </RadioGroup>
        </div>
        <div className="flex items-center gap-1.5 self-end pb-1">
          <Checkbox
            id="selector-pred-case-sensitive"
            checked={caseSensitive}
            onCheckedChange={(v) => onChange({ predicateCaseSensitive: v === true })}
          />
          <Label htmlFor="selector-pred-case-sensitive" className="text-xs font-normal">
            Case-sensitive
          </Label>
        </div>
      </div>
    </div>
  )
}

function NamedKeyFields({
  field,
  value,
  onChange,
}: {
  field: string
  value: string
  onChange: (patch: Partial<SelectorConfigShape>) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="selector-key-field">Field</Label>
        <Input
          id="selector-key-field"
          placeholder="name (blank = whole item)"
          value={field}
          onChange={(e) => onChange({ namedKeyField: e.target.value || undefined })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="selector-key-value">Value</Label>
        <Input
          id="selector-key-value"
          placeholder="hero or {HeroName}"
          value={value}
          onChange={(e) => onChange({ namedKeyValue: e.target.value || undefined })}
        />
        <p className="text-[10px] text-muted-foreground">
          Shortcut for predicate <code>(op=&quot;=&quot;, match=&quot;first&quot;)</code>. Supports <code>{"{NodeLabel}"}</code> refs.
        </p>
      </div>
    </div>
  )
}
