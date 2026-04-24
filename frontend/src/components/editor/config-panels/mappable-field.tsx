"use client"

import { useId } from "react"
import { Link2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import {
  MappableFieldCtx,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { FieldMappings } from "@/types/nodes"
import { getCompatibleSources } from "./helpers"
import type { SourceNodeInfo } from "./types"

/**
 * Wraps a config input with a "Manual / <source>" source picker so the user
 * can bind the field to any upstream text node without wiring its output via
 * the prompt textarea. When mapped, the inline control is swapped for a
 * read-only preview and the underlying input is disabled via context — this
 * prevents typing into a field whose value comes from a source the user
 * explicitly selected.
 */
export function MappableField({
  field,
  label,
  sources,
  fieldMappings,
  onMapField,
  providerCategory,
  labelAction,
  children,
}: {
  readonly field: string
  readonly label: string
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
  readonly providerCategory?: string
  readonly labelAction?: React.ReactNode
  readonly children: React.ReactNode
}) {
  const baseId = useId()
  const labelId = `${baseId}-label`
  const triggerId = `${baseId}-trigger`
  const compatible = getCompatibleSources(field, sources, providerCategory)
  const mapping = fieldMappings[field]
  const mappedSource = mapping ? compatible.find((s) => s.id === mapping.sourceNodeId) : undefined
  const isMapped = !!mappedSource

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[22px]">
        <div className="flex items-center gap-1.5">
          <Label id={labelId} htmlFor={triggerId} className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">{label}</Label>
        </div>
        <div className="flex items-center gap-1">
          {labelAction}
          {compatible.length > 0 && (
            <Select
              value={mapping?.sourceNodeId ?? "__manual__"}
              onValueChange={(v) => onMapField(field, v === "__manual__" ? null : v)}
            >
              <SelectTrigger
                aria-label={`${label} source`}
                className={`h-5 text-[10px] leading-none w-auto max-w-[160px] px-1.5 py-0 gap-1 shrink-0 rounded-md border-0 font-medium transition-colors ${
                  isMapped
                    ? "bg-[#ff0073]/10 text-[#ff0073] hover:bg-[#ff0073]/15 dark:bg-[#ff0073]/15 dark:text-[#ff6aa5]"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-[#2D2D2D] dark:text-[#94A3B8] dark:hover:bg-[#3a3a3a]"
                }`}
              >
                {isMapped && <Link2 className="size-2.5 shrink-0" />}
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-[#1E1E1E] border-gray-200 dark:border-[#2D2D2D] min-w-[160px]">
                <SelectItem value="__manual__" className="text-[11px]">Manual</SelectItem>
                {compatible.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-[11px]">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      {isMapped ? (
        <div className="flex items-start gap-1.5 rounded-lg bg-[#F8FAFC] dark:bg-[#121212] border border-gray-200 dark:border-[#2D2D2D] px-2.5 py-2">
          <Link2 className="size-3 mt-0.5 shrink-0 text-[#ff0073]" />
          <p className="text-xs text-gray-600 dark:text-[#94A3B8] break-words whitespace-pre-wrap flex-1 min-w-0">
            {mappedSource.value || <span className="italic text-gray-400">(source produces no value yet)</span>}
          </p>
        </div>
      ) : (
        <MappableFieldCtx.Provider value={{ labelId, triggerId, title: label }}>
          {children}
        </MappableFieldCtx.Provider>
      )}
    </div>
  )
}
