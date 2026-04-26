"use client"

import { useMemo, useState } from "react"
import { Filter, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { useLocaleDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import type { SingleDimParameterPickerMeta } from "@/lib/parameter-picker-registry"

interface PickerRestrictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: SingleDimParameterPickerMeta
  /** Currently allowed value ids. Empty/undefined = all allowed. */
  value: ReadonlyArray<string> | undefined
  onChange: (value: ReadonlyArray<string> | undefined) => void
}

/**
 * Editor dialog: lets the workflow author whitelist a subset of catalog
 * entries that the published-app viewer can pick from. Saves to
 * cardMeta[nodeId].pickerAllowedValues.
 *
 * undefined / empty array → no restriction (full catalog).
 * non-empty array → only those ids are pickable.
 */
export function PickerRestrictDialog({
  open,
  onOpenChange,
  meta,
  value,
  onChange,
}: PickerRestrictDialogProps) {
  const dir = useLocaleDir()
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog(meta.catalogId)
  const [query, setQuery] = useState("")

  const allIds = useMemo(() => meta.entries.map((e) => e.id), [meta.entries])

  // undefined / empty → "all" (treated as full whitelist for UX)
  const checked = useMemo(() => {
    if (!value || value.length === 0) return new Set(allIds)
    return new Set(value)
  }, [value, allIds])

  const filtered = useMemo(() => {
    return meta.entries.filter((e) =>
      matches(e.id, e.label, e.description, query),
    )
  }, [meta.entries, query, matches])

  const grouped = useMemo(() => {
    if (!meta.groupOrder || !meta.groupLabels) {
      return [{ key: null, label: null, entries: filtered }]
    }
    const map = new Map<string, typeof filtered[number][]>()
    for (const e of filtered) {
      const key = e.group ?? "other"
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    const order = [...meta.groupOrder, "other"]
    return order
      .filter((k) => map.has(k))
      .map((k) => ({
        key: k,
        label: meta.groupLabels?.[k] ?? k,
        entries: map.get(k)!,
      }))
  }, [filtered, meta.groupOrder, meta.groupLabels])

  const checkedCount = checked.size
  const total = allIds.length
  const allChecked = checkedCount === total

  const toggle = (id: string) => {
    const next = new Set(checked)
    if (next.has(id)) {
      if (next.size <= 1) return // Don't allow empty whitelist
      next.delete(id)
    } else {
      next.add(id)
    }
    if (next.size === total) onChange(undefined)
    else onChange(Array.from(next))
  }

  const selectAll = () => onChange(undefined)
  const clearAll = () => {
    // Keep first entry selected so the picker is never empty
    onChange([allIds[0]])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col" dir={dir}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Filter className="size-4 text-[#ff0073]" />
            {`Restrict ${meta.label}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 pb-2">
          <p className="text-xs text-muted-foreground">
            {allChecked
              ? "All values allowed"
              : `${checkedCount}/${total} values allowed`}
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAll}
              disabled={allChecked}
              className="text-xs h-7"
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              disabled={checkedCount <= 1}
              className="text-xs h-7"
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="relative shrink-0 mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={`Search ${meta.label.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-9 text-sm"
            aria-label={`Search ${meta.label}`}
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
          {grouped.length === 0 || filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No matches{query && <> for "{query}"</>}
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.key ?? "all"}>
                {group.label && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                    {group.label}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {group.entries.map((e) => {
                    const isChecked = checked.has(e.id)
                    return (
                      <label
                        key={e.id}
                        className={cn(
                          "flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent/50 transition-colors",
                          isChecked && "bg-[#ff0073]/5",
                        )}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggle(e.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {resolveLabel(e.id, e.label)}
                          </p>
                          <p className="text-[10px] text-muted-foreground line-clamp-1">
                            {resolveDescription(e.id, e.description)}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
