"use client"

import { useState } from "react"
import { CalendarClock, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { SCHEDULE_TRIGGER_NODE_TYPE } from "@nodaro/shared/workflow"
import { isScheduleActive } from "@/lib/schedule-node-rules"

/** What the editor's save resolves to when it has an answer; anything else is taken as "saved". */
function saveFailed(result: unknown): boolean {
  return !!result && typeof result === "object" && "success" in result && (result as { success?: unknown }).success === false
}

/**
 * The editor's top-bar switch for the workflow's schedules. Shown only while
 * the canvas has a Schedule Trigger; hidden read-only. One click turns every
 * schedule in the workflow on (or, when all are on, off) and saves — the
 * switch lives in node data (`active`), and the save is what projects it
 * onto the server's trigger row. The toast waits for the save's answer: a
 * refused save (a remote conflict, a write error) is reported as such, not
 * as "schedule on". Per-schedule control is the node's panel.
 */
export function ScheduleToggle({ onSave }: { readonly onSave: () => void | Promise<unknown> }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const saveRefused = useWorkflowStore(isSaveRefused)
  const total = useWorkflowStore((s) => s.nodes.reduce((n, node) => (node.type === SCHEDULE_TRIGGER_NODE_TYPE ? n + 1 : n), 0))
  const on = useWorkflowStore((s) =>
    s.nodes.reduce((n, node) => (node.type === SCHEDULE_TRIGGER_NODE_TYPE && isScheduleActive(node.data as Record<string, unknown>) ? n + 1 : n), 0),
  )
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  if (total === 0 || isReadOnly || saveRefused) return null

  const allOn = on === total
  const label = allOn ? t("sched.toolbarOn") : on === 0 ? t("sched.toolbarOff") : t("sched.toolbarMixed", { on, total })
  const action = allOn ? t("sched.toolbarTurnOff") : t("sched.toolbarTurnOn")

  const toggle = async () => {
    if (busy) return
    const turnOn = !allOn
    for (const node of useWorkflowStore.getState().nodes) {
      if (node.type === SCHEDULE_TRIGGER_NODE_TYPE) updateNodeData(node.id, { active: turnOn })
    }
    setBusy(true)
    try {
      const result = await onSave()
      if (saveFailed(result)) toast.error(t("sched.toastSaveFailed"))
      else toast.success(turnOn ? t("sched.toastOn") : t("sched.toastOff"))
    } catch {
      toast.error(t("sched.toastSaveFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void toggle() }}
            disabled={busy}
            aria-label={action}
            aria-pressed={allOn}
            data-testid="schedule-toggle"
            className={allOn ? "text-white hover:opacity-90" : ""}
            style={allOn ? { backgroundColor: "#ff0073", borderColor: "#ff0073" } : undefined}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin sm:me-1" /> : <CalendarClock className="h-4 w-4 sm:me-1" />}
            <span className="hidden sm:inline">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{action}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
