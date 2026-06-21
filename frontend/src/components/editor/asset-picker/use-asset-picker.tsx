"use client"

/**
 * Open the in-node AssetPicker from any trigger. Mirrors the `useMediaEditor`
 * pattern: returns an `openPicker()` callback plus a `pickerElement` the caller
 * renders once in its subtree. The modal only mounts its tabs/queries while
 * open, so this is cheap to keep in the tree.
 */
import { useState, type ReactNode } from "react"
import { AssetPickerModal } from "./asset-picker-modal"
import type { EntityKind } from "@/lib/entity-node-data"

export function useAssetPicker({
  kind,
  nodeId,
  currentDbId,
}: {
  kind: EntityKind
  nodeId: string
  currentDbId: string | null
}): { openPicker: () => void; pickerElement: ReactNode } {
  const [open, setOpen] = useState(false)
  return {
    openPicker: () => setOpen(true),
    // Mount the modal ONLY while open. The modal pulls React Query (useQuery /
    // useQueryClient); gating its mount keeps every closed entity node/config
    // free of a QueryClient dependency, so they render anywhere without a
    // provider and the library/gallery fetches fire only on demand.
    pickerElement: open ? (
      <AssetPickerModal
        kind={kind}
        nodeId={nodeId}
        currentDbId={currentDbId}
        open
        onOpenChange={setOpen}
      />
    ) : null,
  }
}
