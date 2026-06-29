"use client"

import { useContext } from "react"
import { Sliders } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { QuickStripOpenChangeContext } from "./node-quick-strip"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { SUNO_SLIDER_META } from "@/lib/suno-sliders"
import type { SunoGenerateData } from "@/types/nodes"

/** On-node "Mix ▾" popover: Suno's 3 advanced sliders with descriptions. Shipped
 *  via NodeQuickStrip's `children` (no quick-config control kind). Pins the strip
 *  while open so the hover toolbar can't hide mid-adjust. */
export function SunoMixPopover({ nodeId }: { readonly nodeId: string }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const setQuickStripPinned = useWorkflowStore((s) => s.setQuickStripPinned)
  const data = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.data) as SunoGenerateData | undefined
  // Inside a NodeQuickStrip, route open-state into the strip's shared openCount
  // (the single pin writer) instead of writing the pin directly — avoids the
  // dual-writer last-writer-wins race. Standalone (no provider) → pin directly.
  const stripOnOpenChange = useContext(QuickStripOpenChangeContext)

  return (
    <Popover
      onOpenChange={(open) =>
        stripOnOpenChange ? stripOnOpenChange(open) : setQuickStripPinned(open ? nodeId : null)
      }
    >
      <PopoverTrigger
        aria-label="Mix"
        title="Mix"
        className="h-6 px-1.5 inline-flex items-center gap-1 rounded-md text-[10px] text-neutral-900/85 hover:bg-black/10 dark:text-white/85 dark:hover:bg-white/10 [&_svg]:size-3 [&_svg]:opacity-70"
      >
        <Sliders />
        <span>Mix</span>
      </PopoverTrigger>
      <PopoverContent
        className="node-menu-surface w-64 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {SUNO_SLIDER_META.map((s) => {
          const val = (data?.[s.key] as number | undefined) ?? s.default
          return (
            <div key={s.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">{s.label}</label>
                <span className="text-xs text-muted-foreground">{val}</span>
              </div>
              <input
                type="range" min={s.min} max={s.max} step={s.step} value={val}
                onChange={(e) => updateNodeData(nodeId, { [s.key]: parseFloat(e.target.value) } as Partial<SunoGenerateData>)}
                className="w-full accent-[#ff0073]"
              />
              <p className="text-[10px] leading-tight text-muted-foreground/70">{s.description}</p>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
