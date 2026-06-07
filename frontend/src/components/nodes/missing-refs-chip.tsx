import { useState } from "react"
import { useStore } from "@xyflow/react"
import { AlertTriangle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useMissingPromptRefs } from "@/hooks/use-missing-prompt-refs"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"
import { cn } from "@/lib/utils"

interface MissingRefsChipProps {
  readonly nodeId: string
  readonly nodeType: string
  readonly handleId: string
}

/**
 * Always-visible warning chip beside a node's Prompt handle listing prompt
 * `{Label}` references with no providing node. Picking one opens the add-node
 * popup pre-named to that ref; the existing connectionContext flow auto-wires
 * the new node to the Prompt handle so the reference resolves.
 *
 * Mounted once inside HandleWithPopover for the prompt target handle, so every
 * prompt-bearing node inherits it. Renders null when there's nothing to add.
 */
export function MissingRefsChip({ nodeId, nodeType, handleId }: MissingRefsChipProps) {
  const missing = useMissingPromptRefs(nodeId)
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const openPopup = useWorkflowStore((s) => s.openAddNodePopupForHandle)
  const zoom = useStore((s) => s.transform[2])
  const [open, setOpen] = useState(false)

  if (isReadOnly || missing.length === 0 || !openPopup) return null

  // Match the handle label's zoom-floor so the chip stays readable when zoomed out.
  const scale = Math.max(1, NODE_VISUAL_SCALE_FLOOR / Math.max(zoom, 0.01))

  const handlePick = (name: string) => {
    setOpen(false)
    openPopup({ nodeId, handleId, direction: "target", nodeType, prefillName: name })
  }

  return (
    <div
      className="absolute nodrag nopan"
      style={{
        top: "calc(100% + 4px)",
        left: "-29px",
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        zIndex: 1002,
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${missing.length} missing prompt input${missing.length > 1 ? "s" : ""}`}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-pointer transition-colors",
              "border-amber-500/60 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400",
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            <span>{missing.length}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-52 p-1">
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
            Add missing input
          </div>
          {missing.map((ref) => (
            <button
              key={ref.name}
              type="button"
              data-testid={`missing-ref-${ref.name}`}
              onClick={() => handlePick(ref.name)}
              className="flex w-full items-center rounded px-2 py-1 text-left text-xs hover:bg-accent"
            >
              <span className="truncate">{`{${ref.name}}`}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
