"use client"

import { useId, memo } from "react"
import { Link2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { MappableFieldCtx } from "@/components/ui/select"
import type { WorkflowEdge } from "@/types/nodes"

/**
 * THE single source of truth for "this Suno field is wired" — used by all three
 * surfaces that must agree (the config-panel `SunoField`, the field-edit modal
 * `SunoField`, and the per-field ✨ `SunoFieldAiButton`). A field is wired when:
 *   - a live edge targets the field's handle — the BARE `prompt` handle for the
 *     prompt field, `field-<key>` for the four secondary fields (style / lyrics /
 *     title / negativeStyle), OR
 *   - a legacy `fieldMappings[field]` entry exists (no edge).
 *
 * Both are honoured by the run's `resolveFieldMappings` (execute-node ~892), so a
 * fieldMappings-only field IS overridden at run; deriving "wired" from the edge
 * alone made `SunoField` render it editable while the AI button hid — a drift.
 * With ONE predicate, a field shows read-only EXACTLY when the AI button hides.
 */
export function isSunoFieldWired(
  field: string,
  data: { readonly fieldMappings?: unknown } | null | undefined,
  edges: ReadonlyArray<WorkflowEdge>,
  nodeId: string | undefined,
): boolean {
  const handleId = field === "prompt" ? "prompt" : `field-${field}`
  const wiredByEdge =
    !!nodeId && edges.some((e) => e.target === nodeId && e.targetHandle === handleId)
  const fieldMappings = data?.fieldMappings as Record<string, unknown> | undefined
  return wiredByEdge || !!fieldMappings?.[field]
}

/**
 * Suno-field wrapper — `MappableField` MINUS the manual "Manual / source"
 * dropdown. A Suno field is bound ONLY by wiring its `field-*` canvas handle
 * (auto-inject, the resolver's top precedence) or by typing a {variable} in the
 * text — never by a per-field source picker. So there is no `sources` /
 * `fieldMappings` / `onMapField` plumbing here.
 *
 * `wired` is computed by the panel (which holds `edges`) from a `field-<field>`
 * edge into the node — for the prompt field the handle id is the bare `prompt`.
 * When wired, the editor (`children`) is NOT mounted: a read-only preview is
 * shown instead, so the user can't type a value the connection will override at
 * run time. The header row always shows `label` + the optional `labelAction`
 * slot (mode toggle / PromptHelper / ✨ AI button) in both states.
 *
 * The label-row + read-only-preview markup mirrors `mappable-field.tsx` so the
 * two surfaces look identical; only the source picker is dropped.
 */
export const SunoField = memo(function SunoField({
  field,
  label,
  wired,
  labelAction,
  children,
}: {
  readonly field: string
  readonly label: string
  readonly wired: boolean
  readonly labelAction?: React.ReactNode
  readonly children: React.ReactNode
}) {
  const baseId = useId()
  const labelId = `${baseId}-label`
  const triggerId = `${baseId}-trigger`

  return (
    <div
      data-suno-field={field}
      className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[22px]">
        <div className="flex items-center gap-1.5">
          <Label id={labelId} htmlFor={wired ? undefined : triggerId} className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">{label}</Label>
        </div>
        <div className="flex items-center gap-1">
          {labelAction}
        </div>
      </div>
      {wired ? (
        <div className="flex items-start gap-1.5 rounded-lg bg-[#F8FAFC] dark:bg-[#121212] border border-gray-200 dark:border-[#2D2D2D] px-2.5 py-2">
          <Link2 className="size-3 mt-0.5 shrink-0 text-[#ff0073]" />
          <p className="text-xs text-gray-600 dark:text-[#94A3B8] break-words whitespace-pre-wrap flex-1 min-w-0">
            <span className="italic text-gray-400">Value comes from the connected handle</span>
          </p>
        </div>
      ) : (
        <MappableFieldCtx.Provider value={{ labelId, triggerId, title: label }}>
          {children}
        </MappableFieldCtx.Provider>
      )}
    </div>
  )
})
