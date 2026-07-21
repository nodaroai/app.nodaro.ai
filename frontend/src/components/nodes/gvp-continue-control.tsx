"use client"

import { RotateCw, ChevronDown } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { GeneratedResult } from "@/types/nodes"

const continueTriggerClass =
  "inline-flex items-center gap-1 !h-6 !px-1.5 text-[10px] font-medium " +
  "text-neutral-900/85 hover:!bg-black/10 dark:text-white/85 dark:hover:!bg-white/10 " +
  "rounded-md whitespace-nowrap [&_svg]:!size-3 [&_svg]:opacity-70 " +
  "[&[data-state=open]]:bg-black/10 dark:[&[data-state=open]]:bg-white/10"

/**
 * Run-strip affordance for the Generate Video Pro node: after a run that was
 * STOPPED (or a failure-rescued partial) — i.e. it delivered fewer than its
 * planned segments — offer to CONTINUE it from a segment. It sets the node's
 * transient continue-intent and fires the node's own Run; execute-node's gvp
 * path then dispatches `continueGenerateVideoPro(fromJobId, fromSegment)`
 * through the normal poll/result path (a new job billed only for the
 * regenerated segments). Renders nothing for a full completion, a
 * single-segment run (no segment accounting), or while running.
 */
export function GvpContinueControl({ nodeId }: { nodeId: string }) {
  const { status, gvpStopped, delivered, segCount, sourceJobId } = useWorkflowStore(
    useShallow((s) => {
      const node = s.nodes.find((n) => n.id === nodeId)
      const d = node?.data as Record<string, unknown> | undefined
      const results = (d?.generatedResults as GeneratedResult[] | undefined) ?? []
      const activeIndex = (d?.activeResultIndex as number | undefined) ?? 0
      return {
        status: d?.executionStatus as string | undefined,
        gvpStopped: d?.gvpStopped === true,
        delivered: typeof d?.gvpDeliveredSegments === "number" ? (d.gvpDeliveredSegments as number) : undefined,
        segCount: typeof d?.gvpSegmentCount === "number" ? (d.gvpSegmentCount as number) : undefined,
        // After completion currentJobId is cleared, so the source is the active
        // result's job — the run being continued.
        sourceJobId: results[activeIndex]?.jobId,
      }
    }),
  )
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  // Continuable = a COMPLETED run (partials land as completed) that delivered
  // fewer segments than planned. Gated on `completed` so a later run's stale
  // flags can never make a fresh failure look continuable.
  const isPartial =
    gvpStopped || (typeof delivered === "number" && typeof segCount === "number" && delivered < segCount)
  if (status !== "completed" || !isPartial || !sourceJobId || !runSingleNode) return null

  const done = typeof delivered === "number" ? delivered : 0
  const total = typeof segCount === "number" ? segCount : done + 1
  const resume = done + 1 // the first not-yet-delivered segment

  const start = (fromSegment: number) => {
    useWorkflowStore.getState().updateNodeData(nodeId, {
      gvpContinueFromJobId: sourceJobId,
      gvpContinueFromSegment: fromSegment,
    })
    runSingleNode?.(nodeId)
  }

  // A user may resume at the first gap, or redo from any earlier delivered
  // segment (the continue route caps `fromSegment` at the first gap = `resume`).
  const redoOptions = Array.from({ length: done }, (_, i) => i + 1) // 1..done

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={continueTriggerClass}
          onClick={(e) => e.stopPropagation()}
          title="Continue this render from a segment"
        >
          <RotateCw />
          Continue
          <ChevronDown />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 node-menu-surface" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          Rendered {done} of {total} segments
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => start(resume)}>
          Resume — from segment {resume}
        </DropdownMenuItem>
        {redoOptions.length > 0 && <DropdownMenuSeparator />}
        {redoOptions.map((s) => (
          <DropdownMenuItem key={s} onClick={() => start(s)}>
            Redo from segment {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
