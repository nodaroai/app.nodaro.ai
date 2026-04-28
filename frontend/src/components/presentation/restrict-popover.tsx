import { useMemo } from "react"
import { Filter } from "lucide-react"
import type { ExposableField } from "@nodaro/shared"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"

interface RestrictPopoverProps {
  field: ExposableField
  allowedValues: Array<string | number | boolean> | undefined
  onUpdate: (allowedValues: Array<string | number | boolean> | undefined) => void
}

export function RestrictPopover({ field, allowedValues, onUpdate }: RestrictPopoverProps) {
  const options = field.options
  if (!options || options.length === 0) return null

  const allValues = useMemo(() => options.map((o) => o.value), [options])
  const total = options.length

  // undefined means all allowed
  const checkedSet = useMemo(() => {
    if (!allowedValues) return new Set(allValues)
    return new Set(allowedValues.map(String))
  }, [allowedValues, allValues])

  const checkedCount = checkedSet.size
  const allChecked = checkedCount === total

  function isChecked(value: string): boolean {
    return checkedSet.has(value)
  }

  function toggle(value: string) {
    const next = new Set(checkedSet)
    if (next.has(value)) {
      // Don't allow unchecking the last item
      if (next.size <= 1) return
      next.delete(value)
    } else {
      next.add(value)
    }

    // If all are checked, store undefined (meaning "all allowed")
    if (next.size === total) {
      onUpdate(undefined)
    } else {
      onUpdate(Array.from(next))
    }
  }

  function selectAll() {
    onUpdate(undefined)
  }

  function clearAll() {
    // Keep at least one value — keep the first option
    onUpdate([allValues[0]])
  }

  const label = allChecked
    ? "Restrict (all)"
    : `Restrict (${checkedCount}/${total})`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground">
          <Filter className="size-3" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">Allowed values</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={selectAll}
              disabled={allChecked}
              className="text-xs h-5 px-1.5"
            >
              Select All
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={clearAll}
              disabled={checkedCount <= 1}
              className="text-xs h-5 px-1.5"
            >
              Clear All
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-accent/50 text-sm"
            >
              <Checkbox
                checked={isChecked(opt.value)}
                onCheckedChange={() => toggle(opt.value)}
              />
              <span className="truncate text-foreground">{opt.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
