"use client"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { FieldMappings } from "@/types/nodes"
import { getCompatibleSources } from "./helpers"
import type { SourceNodeInfo } from "./types"

export function MappableField({
  field,
  label,
  sources,
  fieldMappings,
  onMapField,
  providerCategory,
  children,
}: {
  readonly field: string
  readonly label: string
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
  readonly providerCategory?: string
  readonly children: React.ReactNode
}) {
  const compatible = getCompatibleSources(field, sources, providerCategory)
  const mapping = fieldMappings[field]
  const mappedSource = mapping ? compatible.find((s) => s.id === mapping.sourceNodeId) : undefined
  const isMapped = !!mappedSource

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">{label}</Label>
        {compatible.length > 0 && (
          <Select
            value={mapping?.sourceNodeId ?? "__manual__"}
            onValueChange={(v) => onMapField(field, v === "__manual__" ? null : v)}
          >
            <SelectTrigger className="h-6 text-[10px] w-auto max-w-[140px] px-2 py-0 shrink-0 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-gray-700 dark:text-[#E2E8F0]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white dark:bg-[#1E1E1E] border-gray-200 dark:border-[#2D2D2D]">
              <SelectItem value="__manual__">Manual</SelectItem>
              {compatible.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {isMapped ? (
        <p className="text-xs text-gray-500 dark:text-[#94A3B8] bg-[#F8FAFC] dark:bg-[#121212] rounded-lg px-2.5 py-2 break-words whitespace-pre-wrap border border-gray-200 dark:border-[#2D2D2D]">
          {mappedSource.value || "(empty)"}
        </p>
      ) : (
        children
      )}
    </div>
  )
}
