"use client"

import { useMemo, type MouseEvent } from "react"
import { FastForward, Play, Square, Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { hasCredits } from "@/lib/edition"
import { cancelJob } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { abortNodeRun } from "@/lib/node-run-abort"
import { RUN_BUTTON_CLASS } from "@/lib/run-button-style"
import { getListInputForNode } from "@/components/editor/workflow-editor/node-input-resolver"
import { REPEATABLE_NODE_TYPES, getEffectiveRepeatCount } from "@nodaro/shared"
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
        // Read the status directly so the Stop button shows from the
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

  // The Run (play) button becomes a Stop button the moment the node runs —
  // available immediately from the optimistic "pending" flip, even before a
  // job id exists (the "initiating" window). Stopping cancels the job when
  // there is one, and always clears the running state locally so the node
  // never gets stuck mid-run.
  const isActive = isRunning || nodeStatus === "pending" || nodeStatus === "running"
  if (isActive) {
    const handleStop = (e: MouseEvent) => {
      e.stopPropagation()
      // Actually abort the in-flight run: cancels a streaming SSE fetch (or any
      // execution honoring ctx.signal) immediately. cancelJob below stops a
      // backend job when there is one.
      abortNodeRun(nodeId)
      const markCancelled = () => {
        // Cancelling must NOT destroy access to existing results. Fall back to
        // the last result (→ "completed", point at result 0) when there is one,
        // otherwise just return to "idle". Never a "Failed/Cancelled" state that
        // replaces the node's content.
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
      if (currentJobId) {
        cancelJob(currentJobId).then(markCancelled).catch(markCancelled)
      } else {
        markCancelled()
      }
    }
    // Same look as the Run button (brand-pink outline) — it just spins to show
    // it's running; the icon swaps to a stop square on hover and clicking stops.
    return (
      <button
        type="button"
        aria-label="Stop"
        title="Stop"
        className={`group/stop flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium rounded-md whitespace-nowrap ${RUN_BUTTON_CLASS}`}
        onClick={handleStop}
      >
        <Loader2 className="w-3 h-3 animate-spin group-hover/stop:hidden" />
        <Square className="w-2.5 h-2.5 fill-current hidden group-hover/stop:block" />
        Stop
        {hasCredits() && credits !== undefined && credits > 0 && (
          <span className="ml-1 opacity-80">({totalCredits} CR)</span>
        )}
      </button>
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
