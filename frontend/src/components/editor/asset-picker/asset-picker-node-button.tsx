"use client"

/**
 * Compact in-card "Choose existing / Replace" button for the entity nodes.
 * Sits beside "Open Studio": Studio = create/edit a new asset, this = pick (or
 * swap) an existing one from the library or public gallery. Relabels by bound
 * state so it serves both the empty (Choose) and set (Replace) cases.
 */
import { Library } from "lucide-react"
import { useAssetPicker } from "./use-asset-picker"
import type { EntityKind } from "@/lib/entity-node-data"

export function AssetPickerNodeButton({
  kind,
  nodeId,
  currentDbId,
}: {
  kind: EntityKind
  nodeId: string
  currentDbId: string | null
}) {
  const { openPicker, pickerElement } = useAssetPicker({ kind, nodeId, currentDbId })
  return (
    <>
      <button
        type="button"
        aria-label={currentDbId ? "Replace from library or gallery" : "Choose from library or gallery"}
        className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium bg-muted/40 border border-border text-muted-foreground rounded hover:bg-muted/60 hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation()
          openPicker()
        }}
      >
        <Library className="w-3 h-3" />
        <span>{currentDbId ? "Replace" : "Choose existing"}</span>
      </button>
      {pickerElement}
    </>
  )
}
