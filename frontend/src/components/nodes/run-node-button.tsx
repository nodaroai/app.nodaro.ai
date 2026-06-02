"use client"

import { useMemo, useState } from "react"
import { FastForward, Play, Loader2, Trash2, RotateCcw } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { hasCredits } from "@/lib/edition"
import { cancelJob } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { abortNodeRun } from "@/lib/node-run-abort"
import { RUN_BUTTON_CLASS } from "@/lib/run-button-style"
import { shouldConfirmDiscard, suppressDiscardConfirm } from "@/lib/run-confirm-pref"
import { getListInputForNode } from "@/components/editor/workflow-editor/node-input-resolver"
import { REPEATABLE_NODE_TYPES, getEffectiveRepeatCount } from "@nodaro/shared"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

interface RunNodeButtonProps {
  nodeId: string
  credits?: number
  isRunning: boolean
  onRun: (nodeId: string) => void
  /** When true, shows "Run from here" label with FastForward icon. */
  runFromHere?: boolean
}

export function RunNodeButton({ nodeId, credits, isRunning, onRun, runFromHere }: RunNodeButtonProps) {
  // Narrow subscription: only PRIMITIVES this button renders/derives from — the
  // current job id, a primitive fingerprint of the edges feeding fan-out
  // (incoming targets + outgoing sources for this node), plus this node's type
  // and a fingerprint of the data fields that drive fan-out/repeat credit math.
  // The full node object is read live from getState() inside the memo, so a
  // mutation that touches unrelated node data (or another node entirely) no
  // longer re-renders this button — it renders under 90+ node types, so this
  // is the render-amplification fix.
  const { currentJobId, nodeStatus, nodeType, nodeFingerprint, edgeFingerprint } = useWorkflowStore(
    useShallow((s) => {
      let fp = ""
      for (const e of s.edges) {
        if (e.target === nodeId || e.source === nodeId) {
          fp += `${e.id}\x01${e.source}\x01${e.target}\x01${e.sourceHandle ?? ""}\x01${e.targetHandle ?? ""}\x02`
        }
      }
      const node = s.nodes.find((n) => n.id === nodeId)
      const d = node?.data as Record<string, unknown> | undefined
      return {
        currentJobId: d?.currentJobId as string | undefined,
        // Read the status directly so the running affordance shows from the
        // optimistic "pending" flip (the instant Run is clicked) through
        // "running" — not only once the caller's `isRunning` prop turns true.
        nodeStatus: d?.executionStatus as string | undefined,
        nodeType: node?.type,
        // Credit math reads the whole `data` (getEffectiveRepeatCount +
        // getListInputForNode), so fingerprint it wholesale to guarantee no
        // missed field; `undefined` (node gone) keeps the memo from running.
        nodeFingerprint: node ? JSON.stringify(d ?? {}) : undefined,
        edgeFingerprint: fp,
      }
    }),
  )

  const { fanOutCount, repeatCount } = useMemo(() => {
    if (nodeFingerprint === undefined || !credits || credits <= 0) return { fanOutCount: 1, repeatCount: 1 }
    // Fan-out genuinely needs the full graph (it walks upstream list sources),
    // so read live arrays at compute time. The memo re-runs (via the dep array)
    // when THIS node's data changes (provider/model swaps drive credit display)
    // or its edges change (edgeFingerprint).
    const { nodes, edges } = useWorkflowStore.getState()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return { fanOutCount: 1, repeatCount: 1 }
    const listItems = getListInputForNode(node as WorkflowNode, nodes as WorkflowNode[], edges as WorkflowEdge[])
    const fanOut = listItems ? listItems.length : 1
    const repeats = REPEATABLE_NODE_TYPES.has(nodeType ?? "")
      ? getEffectiveRepeatCount(node.data as Record<string, unknown>)
      : 1
    return { fanOutCount: fanOut, repeatCount: repeats }
  }, [nodeId, nodeType, nodeFingerprint, credits, edgeFingerprint])

  const totalCredits = (credits ?? 0) * fanOutCount * repeatCount

  // Confirm dialog state. `confirmAction` holds the pending discard action;
  // the dialog is open iff it's non-null. `dontAskAgain` mirrors the checkbox.
  const [confirmAction, setConfirmAction] = useState<null | (() => void)>(null)
  const [dontAskAgain, setDontAskAgain] = useState(false)

  // The Run (play) button becomes a running pill the moment the node runs —
  // available immediately from the optimistic "pending" flip. The pill is now a
  // dropdown trigger offering "Run instead" and "Discard"; closing the menu
  // keeps the run going.
  const isActive = isRunning || nodeStatus === "pending" || nodeStatus === "running"

  // Non-destructive revert: fall back to the last result if there is one,
  // otherwise idle. Crucially clears `currentJobId` so the poll loop's
  // `shouldAbandonNode` guard bails without writing the discarded run's result.
  const markCancelled = () => {
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
    const results = (node?.data as Record<string, unknown> | undefined)?.generatedResults
    const hasResults = Array.isArray(results) && results.length > 0
    useWorkflowStore.getState().updateNodeData(nodeId, {
      executionStatus: hasResults ? "completed" : "idle",
      errorMessage: undefined,
      currentJobId: undefined,
      currentJobProgress: undefined,
      ...(hasResults ? { activeResultIndex: 0 } : {}),
    })
  }

  // Discard THIS run. Clear the node's currentJobId FIRST (ordering hazard: the
  // OLD key must be cleared before any re-run writes a NEW one) so the poll loop
  // abandons it; abort any streaming SSE (streaming CAN be cancelled); then fire
  // the phase-aware cancelJob — pre-call cancels+refunds, in-flight finishes →
  // My Library (off the canvas).
  const doDiscard = () => {
    const old = currentJobId
    markCancelled()
    abortNodeRun(nodeId)
    if (old) cancelJob(old).catch(() => {})
  }

  // Gate a discard action behind the confirm dialog unless the user opted out.
  const withConfirm = (action: () => void) => {
    if (shouldConfirmDiscard()) {
      setDontAskAgain(false)
      // Store the action itself — wrap in an arrow so React's functional
      // setState doesn't *call* it.
      setConfirmAction(() => action)
    } else {
      action()
    }
  }

  const onDiscard = () => withConfirm(doDiscard)
  // Discard clears the old job key BEFORE the re-run sets a new one.
  const onRunInstead = () => withConfirm(() => { doDiscard(); onRun(nodeId) })

  // A single shared confirm dialog — both actions discard the current run.
  const confirmDialog = (
    <AlertDialog
      open={confirmAction !== null}
      onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
    >
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this run?</AlertDialogTitle>
          <AlertDialogDescription>
            In-progress jobs can&apos;t be cancelled — they&apos;ll finish and be saved to My
            Library, but won&apos;t appear on the canvas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <Checkbox
            checked={dontAskAgain}
            onCheckedChange={(v) => setDontAskAgain(v === true)}
          />
          Don&apos;t ask again
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setConfirmAction(null)}>Keep running</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (dontAskAgain) suppressDiscardConfirm()
              const action = confirmAction
              setConfirmAction(null)
              action?.()
            }}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (isActive) {
    // Trigger looks IDENTICAL to the prior running pill (brand-pink outline,
    // spinner + "Stop" + price); clicking now opens the menu instead of stopping
    // directly. `e.stopPropagation()` keeps clicks from selecting the node.
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Stop"
              title="Stop"
              className={`flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium rounded-md whitespace-nowrap ${RUN_BUTTON_CLASS}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              Stop
              {hasCredits() && credits !== undefined && credits > 0 && (
                <span className="ml-1 opacity-80">({totalCredits} CR)</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onRunInstead}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Run instead
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDiscard}>
              <Trash2 className="w-4 h-4 mr-2" />
              Discard
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {confirmDialog}
      </>
    )
  }

  const Icon = runFromHere ? FastForward : Play
  const label = runFromHere ? "Run from here" : "Run"

  return (
    <button
      type="button"
      className={`flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium rounded-md whitespace-nowrap ${RUN_BUTTON_CLASS}`}
      onClick={(e) => { e.stopPropagation(); onRun(nodeId) }}
    >
      <Icon className="w-3 h-3" />
      {label}
      {hasCredits() && credits !== undefined && credits > 0 && (
        <span className="ml-1 opacity-80">
          ({totalCredits} CR)
        </span>
      )}
    </button>
  )
}
