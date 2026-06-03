import type { ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModelSearchSelect } from "./model-search-select"

export type MultiProviderPickerProps<P extends string> = {
  /** Selected providers in display order. Always at least one entry. */
  providers: readonly P[]
  /** Full set of pickable models ({value,label,desc}). */
  options: readonly { value: P; label: string; desc?: string }[]
  /** Called with the next ordered list of providers on add / remove / change. */
  onChange: (next: readonly P[]) => void
  /** Optional per-row hover tooltip (e.g. video capability summary). */
  getTooltip?: (value: string) => string | undefined
  /** Optional extended description shown INSIDE each card, below the dropdown. */
  renderHint?: (p: P) => ReactNode
}

export function MultiProviderPicker<P extends string>({
  providers,
  options,
  onChange,
  getTooltip,
  renderHint,
}: MultiProviderPickerProps<P>) {
  const minOne = providers.length === 1
  const allValues = options.map((o) => o.value)
  const addable = allValues.filter((o) => !providers.includes(o))
  const labelOf = (p: P) => options.find((o) => o.value === p)?.label ?? p

  const remove = (idx: number) => onChange(providers.filter((_, i) => i !== idx))
  const change = (idx: number, val: P) => {
    const next = [...providers]
    next[idx] = val
    onChange(next)
  }
  const add = () => {
    if (addable.length === 0) return
    onChange([...providers, addable[0]])
  }

  return (
    <div className="space-y-2">
      {providers.map((p, idx) => {
        // Each row offers its own value + any provider not already selected,
        // so the same model can't be picked into two rows.
        const rowOptions = options.filter((o) => o.value === p || !providers.includes(o.value))
        return (
          <div key={`${p}-${idx}`} className="space-y-1">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <ModelSearchSelect
                  value={p}
                  onChange={(v) => change(idx, v as P)}
                  options={rowOptions}
                  getTooltip={getTooltip}
                  ariaLabel="Provider"
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0 disabled:opacity-30"
                disabled={minOne}
                onClick={() => remove(idx)}
                aria-label={`Remove ${labelOf(p)}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {renderHint?.(p)}
          </div>
        )
      })}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full"
        disabled={addable.length === 0}
        onClick={add}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add another model
      </Button>
    </div>
  )
}
