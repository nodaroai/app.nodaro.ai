import type { ExposableField } from "@nodaro/shared"

interface FieldBadgeProps {
  readonly field: ExposableField
  readonly value: unknown
}

function resolveDisplayValue(field: ExposableField, value: unknown): string {
  switch (field.type) {
    case "select":
    case "aspect-ratio": {
      const strVal = String(value ?? "")
      const match = field.options?.find((o) => o.value === strVal)
      return match ? match.label : strVal
    }
    case "toggle":
      return value ? "On" : "Off"
    case "slider":
      return String(value ?? field.min ?? 0)
    case "text":
      return String(value ?? "")
  }
}

export function FieldBadge({ field, value }: FieldBadgeProps) {
  const displayValue = resolveDisplayValue(field, value)

  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <span className="font-medium">{field.label}:</span>
      <span>{displayValue}</span>
    </span>
  )
}
