"use client"

import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useT, tx } from "@/lib/i18n"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SelectorNodeData } from "@/types/nodes"
import { parseListExpression, type FullSelectorMode, type SelectorConfig as SelectorConfigShape, type SelectorPredicateOp } from "@nodaro/shared"
import type { ConfigProps } from "./types"

// Functions, not consts: a module-level table built with `tx()` at load time
// would freeze on the boot locale (see EFFORT_LABELS in reasoning-effort-select).
function PREDICATE_OPS(): { value: SelectorPredicateOp; label: string }[] {
  return [
    { value: "=", label: tx("utilcfg.opEquals") },
    { value: "!=", label: tx("utilcfg.opNotEquals") },
    { value: ">", label: tx("utilcfg.opGreaterThan") },
    { value: "<", label: tx("utilcfg.opLessThan") },
    { value: ">=", label: tx("cfgext.selOpGreaterOrEqual") },
    { value: "<=", label: tx("cfgext.selOpLessOrEqual") },
    { value: "contains", label: tx("utilcfg.opContains") },
    { value: "not_contains", label: tx("utilcfg.opNotContains") },
    { value: "starts_with", label: tx("utilcfg.opStartsWith") },
    { value: "ends_with", label: tx("utilcfg.opEndsWith") },
    { value: "regex", label: tx("utilcfg.opMatchesRegex") },
    { value: "exists", label: tx("cfgext.selOpExists") },
    { value: "not_exists", label: tx("cfgext.selOpNotExists") },
  ]
}

const PREDICATE_NO_VALUE: ReadonlySet<SelectorPredicateOp> = new Set(["exists", "not_exists"])

function MODES(): { value: FullSelectorMode; label: string }[] {
  return [
    { value: "item", label: tx("cfgext.selModeItem") },
    { value: "range", label: tx("cfgext.selModeRange") },
    { value: "list", label: tx("cfgext.selModeList") },
    { value: "random", label: tx("cfgext.selModeRandom") },
    { value: "modulo", label: tx("cfgext.selModeModulo") },
    { value: "predicate", label: tx("cfgext.selModePredicate") },
    { value: "named-key", label: tx("cfgext.selModeNamedKey") },
  ]
}

export function SelectorConfig({ data, onUpdate }: ConfigProps<SelectorNodeData>) {
  const localizeOption = useLocalizeOptionLabel()
  const t = useT()
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
        <Label>{t("field.mode")}</Label>
        <Select value={mode} onValueChange={(v) => updateMode(v as FullSelectorMode)}>
          <SelectTrigger aria-label={t("field.mode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODES().map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{localizeOption(opt.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          {t("cfgext.selModeHint")}
        </p>
      </div>

      {mode === "item" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="selector-item-index">{t("cfgext.selIndex")}</Label>
          <Input
            id="selector-item-index"
            placeholder="3, last, last-1"
            value={config.itemIndex ?? ""}
            onChange={(e) => updateConfig({ itemIndex: e.target.value || undefined })}
          />
          <p className="text-[10px] text-muted-foreground">
            {t("cfgext.selItemHintA")}<code>last</code>{t("cfgext.selItemHintB")}<code>last-N</code>{t("cfgext.selItemHintC")}
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
          <p className="text-[11px] font-medium text-destructive">{t("cfgext.selError")}</p>
          <p className="text-[10px] text-destructive/90 break-all mt-0.5">{errorMessage}</p>
        </div>
      ) : hasRun ? (
        <div className="rounded-md bg-muted/30 px-3 py-2 border border-border">
          <Label className="text-[11px]">{t("cfgext.selLastRun")}</Label>
          <p className="text-xs text-foreground/80 mt-0.5">
            {t("cfgext.selPickedRest", { picked: pickedTotal, rest: restTotal })}
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
          {t("cfgext.selRunHint")}
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
  const t = useT()
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
      <Label>{t("cfgext.selRange")}</Label>
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{t("cfgext.selFrom")}</span>
          <Input
            placeholder="1"
            value={from}
            onChange={(e) => onChange({ rangeFrom: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{t("cfgext.selTo")}</span>
          <Input
            placeholder="last"
            value={to}
            onChange={(e) => onChange({ rangeTo: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{t("cfgext.selStep")}</span>
          <Input
            inputMode="numeric"
            placeholder="1"
            value={step != null ? String(step) : ""}
            onChange={(e) => handleStep(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {t("cfgext.selRangeHintA")}<code>{"<"} 0</code>{t("cfgext.selRangeHintB")}{">"}{t("cfgext.selRangeHintC")}
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
  const t = useT()
  const validation = parseListExpression(value)
  const isInvalid = value.trim() !== "" && !validation.ok
  const error = !validation.ok ? (validation as { ok: false; error: string }).error : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="selector-list-expression">{t("utilcfg.expression")}</Label>
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
          {t("cfgext.selExamples")}<code>1, 2, last</code> · <code>1..5</code> · <code>1..10:2</code> · <code>1..last-1</code>
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
  const t = useT()
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
        <Label htmlFor="selector-random-seed">{t("field.seedOptional")}</Label>
        <Input
          id="selector-random-seed"
          placeholder={t("cfgext.selSeedPlaceholder")}
          value={seed}
          onChange={(e) => onChange({ seed: e.target.value || undefined })}
        />
        <p className="text-[10px] text-muted-foreground">
          {t("cfgext.selSupportsPrefix")}<code>{"{NodeLabel}"}</code>{t("cfgext.selSeedHintSuffix")}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="selector-random-count">{t("cfgext.selCount")}</Label>
        <Input
          id="selector-random-count"
          inputMode="numeric"
          placeholder="1"
          value={count != null ? String(count) : ""}
          onChange={(e) => handleCount(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">
          {t("cfgext.selCountHint")}
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
  const t = useT()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="selector-modulo-divisor">{t("cfgext.selDivisor")}</Label>
      <Input
        id="selector-modulo-divisor"
        placeholder={t("cfgext.selDivisorPlaceholder")}
        value={divisor}
        onChange={(e) => onChange({ moduloDivisor: e.target.value || undefined })}
      />
      <p className="text-[10px] text-muted-foreground">
        {t("cfgext.selModuloHintA")}<code>{"{NodeLabel}"}</code>{t("cfgext.selModuloHintB")}
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
  const t = useT()
  const noValue = PREDICATE_NO_VALUE.has(op)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_140px] gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="selector-pred-field" className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("utilcfg.field")}
          </Label>
          <Input
            id="selector-pred-field"
            placeholder={t("cfgext.selPredFieldPlaceholder")}
            value={field}
            onChange={(e) => onChange({ predicateField: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="selector-pred-op" className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("cfgext.selOperator")}
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
            <SelectTrigger id="selector-pred-op" aria-label={t("cfgext.selOperator")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PREDICATE_OPS().map((opt) => (
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
          <Label htmlFor="selector-pred-value">{t("cfgext.selValue")}</Label>
          <Input
            id="selector-pred-value"
            placeholder={t("cfgext.selPredValuePlaceholder")}
            value={value}
            onChange={(e) => onChange({ predicateValue: e.target.value || undefined })}
          />
          <p className="text-[10px] text-muted-foreground">
            {t("cfgext.selSupportsPrefix")}<code>{"{NodeLabel}"}</code>{t("cfgext.selPredValueHintSuffix")}
          </p>
        </div>
      )}
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <Label className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("cfgext.selMatch")}
          </Label>
          <RadioGroup
            value={match}
            onValueChange={(v) => onChange({ predicateMatch: v as "first" | "all" })}
            className="flex gap-3"
            aria-label={t("cfgext.selMatch")}
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem id="selector-pred-match-first" value="first" />
              <Label htmlFor="selector-pred-match-first" className="text-xs font-normal">
                {t("cfgext.selFirst")}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem id="selector-pred-match-all" value="all" />
              <Label htmlFor="selector-pred-match-all" className="text-xs font-normal">
                {t("apps.filterAll")}
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
            {t("cfgext.selCaseSensitive")}
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
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="selector-key-field">{t("utilcfg.field")}</Label>
        <Input
          id="selector-key-field"
          placeholder={t("cfgext.selKeyFieldPlaceholder")}
          value={field}
          onChange={(e) => onChange({ namedKeyField: e.target.value || undefined })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="selector-key-value">{t("cfgext.selValue")}</Label>
        <Input
          id="selector-key-value"
          placeholder={t("cfgext.selKeyValuePlaceholder")}
          value={value}
          onChange={(e) => onChange({ namedKeyValue: e.target.value || undefined })}
        />
        <p className="text-[10px] text-muted-foreground">
          {t("cfgext.selKeyHintA")}<code>(op=&quot;=&quot;, match=&quot;first&quot;)</code>{t("cfgext.selKeyHintB")}<code>{"{NodeLabel}"}</code>{t("cfgext.selKeyHintC")}
        </p>
      </div>
    </div>
  )
}
