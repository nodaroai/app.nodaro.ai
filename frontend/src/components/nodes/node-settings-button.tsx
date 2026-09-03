"use client"

import { useT } from "@/lib/i18n"
import { SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

/**
 * The node's settings toggle — opens/closes its config-panel sidebar.
 *
 * Lives at the end of the run strip, immediately left of Run, rather than
 * floating off the node's right edge. The margins around a node are reserved
 * for ports; every control that acts on the node belongs in the one group that
 * already holds its quick config.
 *
 * Rendered from inside {@link RunNodeButton} so all six pills that frame a run
 * strip — the shared {@link NodeRunStripShell} plus the five bespoke toolbars —
 * get it from one place, in the right position, without any of them having to
 * remember. Guarded by `node-settings-button.test.tsx`.
 */
export function NodeSettingsButton({ nodeId }: { readonly nodeId: string }) {
  const t = useT()
  const isEditing = useWorkflowStore((s) => s.selectedNodeId === nodeId)
  const selectNode = useWorkflowStore((s) => s.selectNode)

  return (
    <>
      {/* Separates "what this run will do" from "configure the node". */}
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-black/10 dark:bg-white/15" />
      <button
        type="button"
        data-testid="node-settings-button"
        aria-label={isEditing ? t("node.closeSettings") : t("node.openSettings")}
        aria-pressed={isEditing}
        title={isEditing ? t("node.closeSettings") : t("node.openSettings")}
        // Without this the mousedown starts a canvas drag before the click lands.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          selectNode(isEditing ? null : nodeId)
        }}
        className={cn(
          "nodrag flex items-center justify-center h-6 w-6 shrink-0 rounded-md transition-colors",
          isEditing
            ? "text-[#ff0073]"
            : "text-neutral-500 hover:text-neutral-900 hover:bg-black/5 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10",
        )}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
      </button>
    </>
  )
}
