import { useState, type ReactNode } from "react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getNodeLabel } from "@/lib/presentation-utils"
import { isParameterPickerNode } from "@/lib/parameter-picker-types"
import type { WorkflowNode } from "@/types/nodes"
import { getChipValue, isUploadNode } from "./chat-view-helpers"

/** Inputs that own internal modals / large surfaces — edited in a Dialog, not a popover. */
const TALL_INPUT_TYPES = new Set(["list", "ai-avatar", "cinematic-avatar"])

interface ComposerChipProps {
  node: WorkflowNode
  inputValues: Record<string, Record<string, unknown>>
  renderInputCard: (node: WorkflowNode, variant?: "composer") => ReactNode
  disabled?: boolean
}

/**
 * One composer input rendered as a compact pill. Clicking opens its editor:
 * - uploads render their composer-variant card directly (label + thumbnail +
 *   remove + drop) — no overlay, so the input keeps its identity;
 * - lists / avatars / modal-pickers open a Dialog (they own large surfaces);
 * - text / parameter cards / compact pickers open a Popover.
 */
export function ComposerChip({ node, inputValues, renderInputCard, disabled }: ComposerChipProps) {
  const [open, setOpen] = useState(false)
  const label = getNodeLabel(node)
  const type = node.type ?? ""
  const pickerMode = useWorkflowStore((s) => s.presentationSettings.cardMeta?.[node.id]?.pickerMode)

  // Uploads: render the composer-variant card directly — it already shows the
  // label, thumbnail, a remove button, and an add/drop affordance.
  if (isUploadNode(type)) {
    return (
      <div className={`w-[160px] shrink-0 ${disabled ? "pointer-events-none opacity-60" : ""}`}>
        {renderInputCard(node, "composer")}
      </div>
    )
  }

  const value = getChipValue(node, inputValues)
  const filled = value != null

  const pill = (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-60 ${
        open
          ? "border-[#ff0073] text-foreground"
          : filled
            ? "border-border bg-card text-foreground hover:border-foreground/30"
            : "border-dashed border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {filled ? (
        <span className="truncate text-foreground/90">{value}</span>
      ) : (
        <span className="shrink-0">+ Add</span>
      )}
    </button>
  )

  const isPicker = isParameterPickerNode(type)
  const useDialog = TALL_INPUT_TYPES.has(type) || (isPicker && pickerMode === "modal")

  if (useDialog) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{pill}</DialogTrigger>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          {renderInputCard(node, "composer")}
        </DialogContent>
      </Dialog>
    )
  }

  // Pickers render their compact variant inside the popover; text / parameter
  // cards render the full card for textarea room.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{pill}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        {isPicker ? renderInputCard(node, "composer") : renderInputCard(node)}
      </PopoverContent>
    </Popover>
  )
}
