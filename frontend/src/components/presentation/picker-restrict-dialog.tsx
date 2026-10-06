"use client"

import { useMemo, useState, type ReactNode } from "react"
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
import { usePickerDir } from "@/lib/locale-store"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { getPickerCatalog } from "@nodaro/prompts"
import type { I18nCatalogId } from "@nodaro/shared"
import type { MultiDimParameterPickerMeta, PickerCatalogEntry, SingleDimParameterPickerMeta } from "@/lib/picker-ui"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { usePickerLabel } from "./picker-label"

interface PickerRestrictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: SingleDimParameterPickerMeta
  /** Currently allowed value ids. Empty/undefined = all allowed. */
  value: ReadonlyArray<string> | undefined
  onChange: (value: ReadonlyArray<string> | undefined) => void
}

interface ChecklistDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is being restricted — fills "Restrict {label}". */
  label: string
  catalogId: I18nCatalogId
  entries: ReadonlyArray<PickerCatalogEntry>
  groupOrder?: ReadonlyArray<string>
  groupLabels?: Readonly<Record<string, string>>
  value: ReadonlyArray<string> | undefined
  onChange: (value: ReadonlyArray<string> | undefined) => void
  /** Rendered under the title (the multi-dim dialog's field switcher). */
  header?: ReactNode
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
  const pickerLabel = usePickerLabel(meta)
  return (
    <RestrictChecklistDialog
      open={open}
      onOpenChange={onOpenChange}
      label={pickerLabel}
      catalogId={meta.catalogId}
      entries={meta.entries}
      groupOrder={meta.groupOrder}
      groupLabels={meta.groupLabels}
      value={value}
      onChange={onChange}
    />
  )
}

/** The dimensions of a multi-dimension picker a card can restrict, in field order. */
export function restrictableDimensions(meta: MultiDimParameterPickerMeta) {
  const dims = getPickerCatalog(meta.nodeType)?.dimensions ?? []
  return dims.filter((d) => d.options.length > 0)
}

interface PickerFieldRestrictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: MultiDimParameterPickerMeta
  /** Allowed ids per data field. A field with no entry is unrestricted. */
  value: Readonly<Record<string, ReadonlyArray<string>>> | undefined
  /** The whole next map; `undefined` when no field is restricted any more. */
  onChange: (value: Record<string, string[]> | undefined) => void
}

/**
 * Editor dialog for a multi-dimension picker: choose which field to restrict,
 * then whitelist its values. Saves to cardMeta[nodeId].pickerAllowedValuesByField;
 * selecting every value (or none) removes that field's key.
 */
export function PickerFieldRestrictDialog({ open, onOpenChange, meta, value, onChange }: PickerFieldRestrictDialogProps) {
  const dims = useMemo(() => restrictableDimensions(meta), [meta])
  const [field, setField] = useState<string | undefined>(undefined)
  const t = useT()
  const pickerLabel = usePickerLabel(meta)
  const current = dims.find((d) => d.field === field) ?? dims[0]
  if (!current) return null

  const entries: ReadonlyArray<PickerCatalogEntry> = current.options.map((o) => ({
    id: o.id,
    label: o.label,
    description: o.description ?? "",
    group: o.category,
  }))
  const setFieldValue = (ids: ReadonlyArray<string> | undefined) => {
    const next: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(value ?? {})) if (k !== current.field && v.length > 0) next[k] = [...v]
    if (ids && ids.length > 0) next[current.field] = [...ids]
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }

  return (
    <RestrictChecklistDialog
      open={open}
      onOpenChange={onOpenChange}
      label={current.label}
      catalogId={meta.catalogId}
      entries={entries}
      value={value?.[current.field]}
      onChange={setFieldValue}
      header={
        <Select value={current.field} onValueChange={setField}>
          <SelectTrigger className="h-8 text-xs" aria-label={t("present.restrictLabel", { label: pickerLabel })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {dims.map((d) => (
              <SelectItem key={d.field} value={d.field}>
                {d.label}
                {(value?.[d.field]?.length ?? 0) > 0 ? ` (${value![d.field]!.length}/${d.options.length})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

function RestrictChecklistDialog({
  open,
  onOpenChange,
  label: pickerLabel,
  catalogId,
  entries,
  groupOrder,
  groupLabels,
  value,
  onChange,
  header,
}: ChecklistDialogProps) {
  const dir = usePickerDir()
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog(catalogId)
  const [query, setQuery] = useState("")
  const t = useT()

  const allIds = useMemo(() => entries.map((e) => e.id), [entries])

  // undefined / empty → "all" (treated as full whitelist for UX)
  const checked = useMemo(() => {
    if (!value || value.length === 0) return new Set(allIds)
    return new Set(value)
  }, [value, allIds])

  const filtered = useMemo(() => {
    return entries.filter((e) =>
      matches(e.id, e.label, e.description, query),
    )
  }, [entries, query, matches])

  const grouped = useMemo(() => {
    if (!groupOrder || !groupLabels) {
      return [{ key: null, label: null, entries: filtered }]
    }
    const map = new Map<string, typeof filtered[number][]>()
    for (const e of filtered) {
      const key = e.group ?? "other"
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    const order = [...groupOrder, "other"]
    return order
      .filter((k) => map.has(k))
      .map((k) => ({
        key: k,
        label: groupLabels?.[k] ?? k,
        entries: map.get(k)!,
      }))
  }, [filtered, groupOrder, groupLabels])

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
            {t("present.restrictLabel", { label: pickerLabel })}
          </DialogTitle>
        </DialogHeader>
        {header}

        <div className="flex items-center justify-between gap-2 pb-2">
          <p className="text-xs text-muted-foreground">
            {allChecked
              ? t("present.allValuesAllowed")
              : t("present.valuesAllowedCount", { n: checkedCount, total })}
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAll}
              disabled={allChecked}
              className="text-xs h-7"
            >
              {t("present.selectAllEntries")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              disabled={checkedCount <= 1}
              className="text-xs h-7"
            >
              {t("common.clear")}
            </Button>
          </div>
        </div>

        <div className="relative shrink-0 mb-2">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t("present.searchLabelPlaceholder", { label: pickerLabel.toLowerCase() })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-8 h-9 text-sm"
            aria-label={t("present.searchLabel", { label: pickerLabel })}
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
          {grouped.length === 0 || filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {query ? t("present.noMatchesFor", { query }) : t("present.noMatches")}
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
