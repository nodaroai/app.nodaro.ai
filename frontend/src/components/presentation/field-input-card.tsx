import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { ExposableField } from "@nodaro-shared/presentation-types"
import { AspectRatioSelector } from "@/components/editor/config-panels/aspect-ratio-selector"
import { GlassCard } from "./output-cards/shared"

interface FieldInputCardProps {
  field: ExposableField
  value: unknown
  onChange: (value: unknown) => void
  allowedValues?: Array<string | number | boolean>
  readOnly?: boolean
  /** Override the field label with a custom title */
  customLabel?: string
}

const LABEL_CLS =
  "text-xs font-medium text-muted-foreground uppercase tracking-wider"

function SelectField({
  field,
  value,
  onChange,
  allowedValues,
  readOnly,
}: FieldInputCardProps) {
  const options = allowedValues
    ? (field.options ?? []).filter((o) =>
        allowedValues.some((av) => String(av) === o.value),
      )
    : (field.options ?? [])

  // Map empty string ↔ __none__ sentinel to avoid Radix Select crash on empty value
  const hasNoneSentinel = options.some((o) => o.value === "__none__")
  const rawValue = String(value ?? "")
  const strValue = hasNoneSentinel && rawValue === "" ? "__none__" : rawValue

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{field.label}</Label>
      <Select
        value={strValue}
        onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
        disabled={readOnly}
      >
        <SelectTrigger
          className={cn("w-full", readOnly && "opacity-70 cursor-default")}
          aria-label={field.label}
        >
          <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </GlassCard>
  )
}

function SliderField({
  field,
  value,
  onChange,
  readOnly,
}: Omit<FieldInputCardProps, "allowedValues">) {
  const min = field.min ?? 0
  const max = field.max ?? 100
  const step = field.step ?? 1
  const numValue = Number(value ?? min)

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <Label className={LABEL_CLS}>{field.label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {numValue}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={numValue}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={readOnly}
          className={cn("flex-1", readOnly && "opacity-70 cursor-default")}
        />
      </div>
    </GlassCard>
  )
}

function ToggleField({
  field,
  value,
  onChange,
  readOnly,
}: Omit<FieldInputCardProps, "allowedValues">) {
  const checked = Boolean(value)

  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <Label className={LABEL_CLS}>{field.label}</Label>
        <Switch
          checked={checked}
          onCheckedChange={(v) => onChange(v)}
          disabled={readOnly}
          className={cn(readOnly && "opacity-70 cursor-default")}
        />
      </div>
    </GlassCard>
  )
}

function AspectRatioField({
  field,
  value,
  onChange,
  allowedValues,
  readOnly,
}: FieldInputCardProps) {
  const options = allowedValues
    ? (field.options ?? []).filter((o) =>
        allowedValues.some((av) => String(av) === o.value),
      )
    : (field.options ?? [])

  const strValue = String(value ?? "")

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{field.label}</Label>
      <AspectRatioSelector
        options={options}
        value={strValue}
        onValueChange={(v) => onChange(v)}
        className={cn(readOnly && "opacity-70 pointer-events-none")}
      />
    </GlassCard>
  )
}

function TextField({
  field,
  value,
  onChange,
  readOnly,
}: Omit<FieldInputCardProps, "allowedValues">) {
  const strValue = String(value ?? "")

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{field.label}</Label>
      <Textarea
        value={strValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${field.label.toLowerCase()}...`}
        readOnly={readOnly}
        className={cn(
          "min-h-[72px] resize-none",
          readOnly && "opacity-70 cursor-default",
        )}
      />
    </GlassCard>
  )
}

export function FieldInputCard(props: FieldInputCardProps) {
  // Apply custom label override if provided
  const effectiveProps = props.customLabel
    ? { ...props, field: { ...props.field, label: props.customLabel } }
    : props
  switch (props.field.type) {
    case "select":
      return <SelectField {...effectiveProps} />
    case "aspect-ratio":
      return <AspectRatioField {...effectiveProps} />
    case "slider":
      return <SliderField {...effectiveProps} />
    case "toggle":
      return <ToggleField {...effectiveProps} />
    case "text":
      return <TextField {...effectiveProps} />
  }
}
