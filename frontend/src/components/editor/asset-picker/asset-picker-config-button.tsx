"use client"

/**
 * Full-width "Choose / Replace from Library or Gallery" row for the entity
 * config panels (Character / Object / Creature / Location). Opens the shared
 * AssetPicker; the bind/replace is handled inside the modal.
 */
import { Library } from "lucide-react"
import { useAssetPicker } from "./use-asset-picker"
import type { EntityKind } from "@/lib/entity-node-data"

export function AssetPickerConfigButton({
  kind,
  nodeId,
  currentDbId,
}: {
  kind: EntityKind
  nodeId?: string
  currentDbId: string | null
}) {
  const { openPicker, pickerElement } = useAssetPicker({ kind, nodeId: nodeId ?? "", currentDbId })
  const label = currentDbId ? "Replace from Library / Gallery" : "Choose from Library / Gallery"
  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        disabled={!nodeId}
        className="w-full flex items-center gap-2 text-[11px] bg-muted/30 border border-border rounded-md px-3 py-2 hover:bg-muted/50 transition-colors disabled:opacity-50"
        aria-label={label}
      >
        <Library className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-left text-muted-foreground">{label}</span>
      </button>
      {pickerElement}
    </>
  )
}
