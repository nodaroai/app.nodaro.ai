import type { ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select"

export type MultiProviderPickerProps<P extends string> = {
  /** Selected providers in display order. Always at least one entry. */
  providers: readonly P[]
  /** Full set of pickable provider ids — used to compute remaining options for "Add another model". */
  options: readonly P[]
  /** Called with the next ordered list of providers on add / remove / change. */
  onChange: (next: readonly P[]) => void
  /** Trigger-display label for a provider (used by aria-labels on the X buttons). */
  labelOf: (p: P) => string
  /** Renders the dropdown items (`<SelectItem>` / `<ModelSelectOption>` etc.) for the
   *  given row. Receives the current value so the parent can hide already-picked
   *  providers from OTHER rows. */
  renderItems: (current: P) => ReactNode
  /** Optional extended description shown INSIDE each card, below the dropdown. */
  renderHint?: (p: P) => ReactNode
}

export function MultiProviderPicker<P extends string>({
  providers,
  options,
  onChange,
  labelOf,
  renderItems,
  renderHint,
}: MultiProviderPickerProps<P>) {
  const minOne = providers.length === 1
  const addable = options.filter((o) => !providers.includes(o))

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
      {providers.map((p, idx) => (
        <div key={`${p}-${idx}`} className="space-y-1">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Select value={p} onValueChange={(v) => change(idx, v as P)}>
                <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
                <SelectContent>{renderItems(p)}</SelectContent>
              </Select>
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
      ))}

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
