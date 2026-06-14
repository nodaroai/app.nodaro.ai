import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowUp, ChevronDown, ChevronUp, Download, Loader2, RotateCcw } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { getNodeLabel, getOutputType } from "@/lib/presentation-utils"
import { ORIGINAL_SLOT_ID, type RunSlot, type RunSlotNodeState } from "@/components/app-runner/types"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { OutputStatus } from "../output-cards/shared"
import { OutputCard } from "../output-card"
import { buildStepChips, getMessageSummary, getThreadMessages, shouldExpandComposer, type StepChip } from "./chat-view-helpers"

/** Minimal slot of the useRunSlots API that ChatView consumes (avoids coupling to the full hook type). */
export interface ChatRunSlotsApi {
  slots: RunSlot[]
  activeSlotId: string | null
  handleCreateNew: () => void
  handleDuplicateSlot: (slotId: string) => void
  handleSelectSlot: (slotId: string) => void
}

interface ChatViewProps {
  orderedInputNodes: WorkflowNode[]
  orderedOutputNodes: WorkflowNode[]
  renderInputCard: (node: WorkflowNode) => ReactNode
  onOpenMedia?: (nodeId: string) => void
  runSlots?: ChatRunSlotsApi
  appName?: string
  appDescription?: string
}

function outputUrl(out: Record<string, unknown> | undefined): string | undefined {
  if (!out) return undefined
  return (out.imageUrl ?? out.videoUrl ?? out.audioUrl ?? out.url ?? out.resultUrl) as string | undefined
}

function toOutputStatus(nodeStatus: RunSlotNodeState["status"] | undefined, slotStatus: RunSlot["executionStatus"]): OutputStatus {
  switch (nodeStatus) {
    case "completed": return "completed"
    case "failed": return "failed"
    case "running": return "running"
    case "skipped": return "idle"
    default: return slotStatus === "running" ? "waiting" : "idle"
  }
}

function chipClass(s: StepChip["status"]): string {
  switch (s) {
    case "completed": return "bg-green-500/10 text-green-600 border-green-500/20"
    case "running": return "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/20"
    case "failed": return "bg-red-500/10 text-red-600 border-red-500/20"
    case "skipped": return "bg-muted text-muted-foreground/50 border-border"
    default: return "bg-muted/60 text-muted-foreground border-border"
  }
}

export function ChatView({
  orderedInputNodes,
  orderedOutputNodes,
  renderInputCard,
  onOpenMedia,
  runSlots,
  appName,
  appDescription,
}: ChatViewProps) {
  const execStatus = useAppRunnerStore((s) => s.executionStatus)
  const combinedProgress = useAppRunnerStore((s) => s.combinedProgress)
  const run = usePresentationStore((s) => s.run)
  const nodes = usePresentationStore((s) => s.nodes)
  const edges = usePresentationStore((s) => s.edges)

  const isRunning = execStatus === "running" || execStatus === "loading"
  const slots = runSlots?.slots ?? []
  const messages = getThreadMessages(slots)

  // Adaptive composer expand (design decision B), with a session-persisted manual override.
  const storageKey = `chat-composer-expanded:${appName ?? "app"}`
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved != null) return saved === "1"
    } catch { /* ignore */ }
    return shouldExpandComposer(orderedInputNodes)
  })
  const toggleExpanded = () => {
    setExpanded((e) => {
      const next = !e
      try { sessionStorage.setItem(storageKey, next ? "1" : "0") } catch { /* ignore */ }
      return next
    })
  }

  // One run at a time (Option A): when the active run reaches a terminal state, mint the
  // next draft (seeded from it, so users can iterate) and re-enable the composer.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !isRunning && (execStatus === "completed" || execStatus === "failed")) {
      const active = runSlots?.activeSlotId
      if (active && active !== ORIGINAL_SLOT_ID) runSlots?.handleDuplicateSlot(active)
    }
    wasRunning.current = isRunning
  }, [isRunning, execStatus, runSlots])

  // Auto-scroll to the newest message on launch and on completion.
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth" })
  }, [messages.length, execStatus])

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const toggleSteps = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleLaunch = async () => {
    if (isRunning) return
    await run()
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4" style={{ paddingBottom: "max(0.5rem, var(--safe-area-bottom))" }}>
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 sm:py-24">
              <h2 className="text-2xl font-semibold text-foreground mb-2">{appName || "Run this app"}</h2>
              {appDescription && <p className="text-muted-foreground max-w-md">{appDescription}</p>}
            </div>
          ) : (
            messages.map(({ slot }) => (
              <ChatMessage
                key={slot.id}
                slot={slot}
                inputNodes={orderedInputNodes}
                outputNodes={orderedOutputNodes}
                nodes={nodes}
                edges={edges}
                combinedProgress={combinedProgress}
                onOpenMedia={onOpenMedia}
                onReuse={() => runSlots?.handleDuplicateSlot(slot.id)}
                stepsExpanded={expandedSteps.has(slot.id)}
                onToggleSteps={() => toggleSteps(slot.id)}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-card/40 px-3 sm:px-6 py-3 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-2xl border border-border bg-background p-3">
            {orderedInputNodes.length > 1 && (
              <button
                type="button"
                onClick={toggleExpanded}
                title={expanded ? "Collapse" : "Expand inputs"}
                className="absolute -top-3 right-4 h-6 w-6 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
            )}
            {orderedInputNodes.length > 0 && (
              <div
                className={`flex flex-col gap-2 overflow-y-auto ${expanded ? "max-h-[45vh]" : "max-h-[150px]"} ${isRunning ? "pointer-events-none opacity-60" : ""}`}
              >
                {orderedInputNodes.map((node) => (
                  <div key={node.id}>{renderInputCard(node)}</div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-end mt-2">
              <button
                type="button"
                onClick={handleLaunch}
                disabled={isRunning}
                className="flex items-center gap-1.5 rounded-xl bg-[#ff0073] text-white px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isRunning ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
                ) : (
                  <>Launch <ArrowUp className="h-3.5 w-3.5" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ChatMessageProps {
  slot: RunSlot
  inputNodes: WorkflowNode[]
  outputNodes: WorkflowNode[]
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  combinedProgress: Record<string, number>
  onOpenMedia?: (nodeId: string) => void
  onReuse: () => void
  stepsExpanded: boolean
  onToggleSteps: () => void
}

function ChatMessage({
  slot,
  inputNodes,
  outputNodes,
  nodes,
  edges,
  combinedProgress,
  onOpenMedia,
  onReuse,
  stepsExpanded,
  onToggleSteps,
}: ChatMessageProps) {
  const summary = getMessageSummary(slot, inputNodes)
  const chips = buildStepChips(nodes, edges, outputNodes.map((n) => n.id), slot.nodeStates)
  const isRunning = slot.executionStatus === "running"
  const isDone = slot.executionStatus === "completed"

  // Thumbnail: first output media, else first uploaded input.
  let thumb: string | undefined
  for (const n of outputNodes) {
    thumb = outputUrl(slot.nodeStates[n.id]?.output)
    if (thumb) break
  }
  if (!thumb) {
    for (const n of inputNodes) {
      const u = slot.inputValues[n.id]?.url as string | undefined
      if (u) { thumb = u; break }
    }
  }

  const downloadUrl = (() => {
    for (const n of outputNodes) {
      const u = outputUrl(slot.nodeStates[n.id]?.output)
      if (u) return u
    }
    return undefined
  })()

  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-3">
      {/* Input summary */}
      <div className="w-24 sm:w-28 shrink-0">
        <div className="h-16 sm:h-20 rounded-lg bg-muted/40 overflow-hidden flex items-center justify-center">
          {thumb ? (
            <CachedImage src={thumb} alt="" thumbnail thumbnailWidth={224} className="w-full h-full object-cover" />
          ) : (
            <span className="text-[10px] text-muted-foreground">{slot.executionStatus}</span>
          )}
        </div>
        <div className="text-xs font-medium text-foreground truncate mt-1.5">{summary.label}</div>
        <div className="text-[10px] text-muted-foreground">
          {summary.inputCount} {summary.inputCount === 1 ? "input" : "inputs"}{summary.creditsUsed ? ` · ${summary.creditsUsed} cr` : ""}
        </div>
      </div>

      {/* Outputs + steps */}
      <div className="flex-1 min-w-0">
        <div className="grid gap-2">
          {outputNodes.map((node) => {
            const st = slot.nodeStates[node.id]
            const out = st?.output
            return (
              <OutputCard
                key={node.id}
                nodeId={node.id}
                label={getNodeLabel(node)}
                outputType={getOutputType(node.type)}
                status={toOutputStatus(st?.status, slot.executionStatus)}
                url={outputUrl(out)}
                text={out?.text as string | undefined}
                onOpenMedia={onOpenMedia}
                progress={isRunning ? combinedProgress[node.id] : undefined}
              />
            )
          })}
        </div>

        {chips.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map((c) => (
              <span key={c.nodeId} className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${chipClass(c.status)}`}>
                {c.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />}
                {c.label}
                {c.status === "completed" ? " ✓" : c.status === "failed" ? " ✕" : ""}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
          <button type="button" onClick={onReuse} className="inline-flex items-center gap-1 hover:text-foreground">
            <RotateCcw className="h-3 w-3" /> Re-use inputs
          </button>
          {chips.length > 1 && (
            <button type="button" onClick={onToggleSteps} className="inline-flex items-center gap-1 hover:text-foreground">
              {stepsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {stepsExpanded ? "Hide steps" : "See steps"}
            </button>
          )}
          {isDone && downloadUrl && (
            <a href={downloadUrl} download className="inline-flex items-center gap-1 hover:text-foreground">
              <Download className="h-3 w-3" /> Download
            </a>
          )}
        </div>

        {stepsExpanded && chips.length > 1 && (
          <div className="mt-2 grid gap-2 border-t border-border pt-2">
            {chips.map((c) => {
              const node = nodes.find((n) => n.id === c.nodeId)
              const out = slot.nodeStates[c.nodeId]?.output
              return (
                <OutputCard
                  key={c.nodeId}
                  nodeId={c.nodeId}
                  label={c.label}
                  outputType={node ? getOutputType(node.type) : "text"}
                  status={toOutputStatus(c.status, slot.executionStatus)}
                  url={outputUrl(out)}
                  text={out?.text as string | undefined}
                  onOpenMedia={onOpenMedia}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
