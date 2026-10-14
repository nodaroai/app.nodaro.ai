import type { ExposableField } from "@nodaro/shared/types"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { quickFieldValueLabel, type ResolvedExposableField } from "./exposable-fields"
import { useT, type TFunction } from "@/lib/i18n"

interface FieldBadgeProps {
  readonly field: ResolvedExposableField
  readonly value: unknown
  /** The node's data with the run's values on top: a strip-derived field reads its option label from it. */
  readonly nodeData?: Record<string, unknown>
}

function resolveDisplayValue(field: ExposableField, value: unknown, t: TFunction): string {
  switch (field.type) {
    case "select":
    case "aspect-ratio": {
      const strVal = String(value ?? "")
      const match = field.options?.find((o) => o.value === strVal)
      return match ? match.label : strVal
    }
    case "toggle":
      return value ? t("common.stateOn") : t("common.stateOff")
    case "slider":
      return String(value ?? field.min ?? 0)
    case "text":
    case "color":
      return String(value ?? "")
  }
}

export function FieldBadge({ field, value, nodeData }: FieldBadgeProps) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const quickLabel = nodeData ? quickFieldValueLabel(field, nodeData) : undefined
  const displayValue = quickLabel !== undefined ? localizeOption(quickLabel) : resolveDisplayValue(field, value, t)

  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <span className="font-medium">{field.label}:</span>
      <span>{displayValue}</span>
    </span>
  )
}
