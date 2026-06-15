import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, Download, Loader2, Music, RotateCcw, Square } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { getNodeLabel, getOutputType } from "@/lib/presentation-utils"
import { type RunSlot, type RunSlotNodeState } from "@/components/app-runner/types"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { OutputStatus } from "../output-cards/shared"
import { OutputCard } from "../output-card"
import {
  buildStepChips,
  getThreadMessages,
  isUploadNode,
  outputUrl,
  firstStringValue,
  resolveSlotResult,
  type StepChip,
} from "./chat-view-helpers"
import { ComposerBar } from "./composer-bar"
import { FullscreenView } from "./fullscreen-view"
import type { RunSlotsApi } from "./types"

interface ChatViewProps {
  orderedInputNodes: WorkflowNode[]
  orderedOutputNodes: WorkflowNode[]
  renderInputCard: (node: WorkflowNode, variant?: "composer") => ReactNode
  runSlots?: RunSlotsApi
  appName?: string
  appDescription?: string
  /** Snapshot the draft into a new run and execute it (no draft reset). Falls back to `run`. */
  launch?: () => void
  /** Monetized credit cost label, e.g. " (12 CR)". */
  costLabel?: string
  needsMoreCredits?: boolean
  allInputsFilled?: boolean
}

/** Stable empty progress map for runs with no live runtime (avoids a new {} per render). */
const EMPTY_PROGRESS: Record<string, number> = {}

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
  runSlots,
  appName,
  appDescription,
  launch,
  costLabel,
  needsMoreCredits,
  allInputsFilled,
}: ChatViewProps) {
  // Per-run live execution state — each thread message reads its OWN run's
  // progress, so concurrent runs don't share a single (colliding) progress map.
  const runtimes = useAppRunnerStore((s) => s.runtimes)
  const cancel = useAppRunnerStore((s) => s.cancel)
  const run = usePresentationStore((s) => s.run)
  const nodes = usePresentationStore((s) => s.nodes)
  const edges = usePresentationStore((s) => s.edges)
  const inputValues = usePresentationStore((s) => s.inputValues)

  const slots = runSlots?.slots ?? []
  const messages = getThreadMessages(slots)

  // The result viewer (a frozen run + the clicked node). Opened from a message.
  const [viewer, setViewer] = useState<{ slot: RunSlot; nodeId: string } | null>(null)

  // Auto-scroll when a NEW run message appears (not on every progress tick —
  // that would fight a user who scrolled up to read an earlier run mid-stream).
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth" })
  }, [messages.length])

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const toggleSteps = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Concurrent runs: Launch is NOT blocked by in-flight runs — `launching` is a
  // transient guard against double-firing the SAME draft while its run is set up.
  // The ref makes the guard synchronous (a stale `launching` closure would let a
  // rapid second click through and double-charge the run).
  const launchingRef = useRef(false)
  const [launching, setLaunching] = useState(false)
  const handleLaunch = async () => {
    if (launchingRef.current) return
    launchingRef.current = true
    setLaunching(true)
    try {
      await (launch ?? run)()
    } finally {
      launchingRef.current = false
      setLaunching(false)
    }
  }

  // Stable across renders so OutputCard's memo holds for terminal messages
  // during a run's 2s progress poll (each message re-binds it to its own slot).
  const openResult = useCallback((slot: RunSlot, nodeId: string) => setViewer({ slot, nodeId }), [])

  // ↑/↓ in the viewer walks the THREAD (oldest→newest), keeping the same node
  // when the target run has a result for it, else its first available output.
  const handleViewerRunChange = (dir: 1 | -1) => {
    setViewer((v) => {
      if (!v) return v
      const idx = messages.findIndex((m) => m.slot.id === v.slot.id)
      if (idx < 0) return v
      const nextIdx = idx + dir
      if (nextIdx < 0 || nextIdx >= messages.length) return v
      const nextSlot = messages[nextIdx].slot
      const same = resolveSlotResult(nextSlot, v.nodeId)
      if (same.url || same.text) return { slot: nextSlot, nodeId: v.nodeId }
      const firstOut = orderedOutputNodes.find((n) => {
        const r = resolveSlotResult(nextSlot, n.id)
        return r.url || r.text
      })
      return { slot: nextSlot, nodeId: firstOut?.id ?? v.nodeId }
    })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4" style={{ paddingBottom: "max(0.5rem, var(--safe-area-bottom))" }}>
        <div className="max-w-5xl mx-auto flex flex-col gap-3">
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
                combinedProgress={runtimes[slot.id]?.combinedProgress ?? EMPTY_PROGRESS}
                onOpenResult={openResult}
                onStop={() => cancel(slot.id)}
                onReuse={() => runSlots?.handleDuplicateSlot(slot.id)}
                stepsExpanded={expandedSteps.has(slot.id)}
                onToggleSteps={() => toggleSteps(slot.id)}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer — compact chip bar */}
      <div className="border-t border-border bg-card/40 px-3 sm:px-6 py-3 shrink-0" style={{ paddingBottom: "max(0.75rem, var(--safe-area-bottom))" }}>
        <div className="mx-auto max-w-5xl">
          <ComposerBar
            inputNodes={orderedInputNodes}
            inputValues={inputValues}
            renderInputCard={renderInputCard}
            isRunning={launching}
            costLabel={costLabel ?? ""}
            allInputsFilled={allInputsFilled ?? true}
            needsMoreCredits={needsMoreCredits ?? false}
            onLaunch={handleLaunch}
          />
        </div>
      </div>

      {viewer && (
        <FullscreenView
          asOverlay
          orderedInputNodes={orderedInputNodes}
          orderedOutputNodes={orderedOutputNodes}
          getNodeStatus={() => "completed"}
          getResult={() => ({})}
          getCardTitle={getNodeLabel}
          resolveResult={(nodeId) => resolveSlotResult(viewer.slot, nodeId)}
          initialNodeId={viewer.nodeId}
          onRunChange={handleViewerRunChange}
          onBack={() => setViewer(null)}
        />
      )}
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
  onOpenResult: (slot: RunSlot, nodeId: string) => void
  onStop: () => void
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
  onOpenResult,
  onStop,
  onReuse,
  stepsExpanded,
  onToggleSteps,
}: ChatMessageProps) {
  // Memoized: the graph is stable and slot.nodeStates keeps its identity for a
  // terminal message (fan-out skip-guard), so only the running message recomputes.
  const chips = useMemo(
    () => buildStepChips(nodes, edges, outputNodes.map((n) => n.id), slot.nodeStates),
    [nodes, edges, outputNodes, slot.nodeStates],
  )
  const isRunning = slot.executionStatus === "running"
  const isDone = slot.executionStatus === "completed"

  // Bound to this message's slot; stable across the run's progress poll so the
  // memoized OutputCards below don't reconcile on every tick.
  const openResult = useCallback((nodeId: string) => onOpenResult(slot, nodeId), [onOpenResult, slot])

  // The submitted inputs for this run (the left section).
  const promptTexts = inputNodes
    .filter((n) => n.type === "text-prompt")
    .map((n) => ((slot.inputValues[n.id]?.text as string) ?? "").trim())
    .filter(Boolean)
  const inputMedia = inputNodes
    .filter((n) => isUploadNode(n.type))
    .map((n) => ({ node: n, url: slot.inputValues[n.id]?.url as string | undefined }))
    .filter((a) => !!a.url)
  const otherInputs = inputNodes
    .filter((n) => n.type !== "text-prompt" && !isUploadNode(n.type))
    .map((n) => ({ label: getNodeLabel(n), value: firstStringValue(slot.inputValues[n.id]) }))
    .filter((o) => !!o.value)
  const hasInput = promptTexts.length > 0 || inputMedia.length > 0 || otherInputs.length > 0

  const downloadUrl = (() => {
    for (const n of outputNodes) {
      const u = outputUrl(slot.nodeStates[n.id]?.output)
      if (u) return u
    }
    return undefined
  })()

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:gap-5">
        {/* INPUT (left) */}
        <div className="flex min-w-0 flex-col gap-2 md:w-2/5 md:border-r md:border-border md:pr-5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Input</span>
          {promptTexts.map((t, i) => (
            <p key={i} className="whitespace-pre-wrap break-words text-sm text-foreground line-clamp-[8]">{t}</p>
          ))}
          {inputMedia.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {inputMedia.map(({ node, url }) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => openResult(node.id)}
                  className="h-14 w-14 overflow-hidden rounded-md bg-muted/40"
                  title="View"
                >
                  {node.type === "upload-video" ? (
                    <video src={url} className="h-full w-full object-cover" muted playsInline />
                  ) : node.type === "upload-audio" ? (
                    <span className="flex h-full w-full items-center justify-center"><Music className="h-5 w-5 text-muted-foreground" /></span>
                  ) : (
                    <CachedImage src={url} alt="" thumbnail thumbnailWidth={112} className="h-full w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
          {otherInputs.map((o, i) => (
            <div key={i} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">{o.label}:</span> {o.value}
            </div>
          ))}
          {!hasInput && (
            <span className="text-xs text-muted-foreground">{slot.creditsUsed ? `${slot.creditsUsed} cr` : "—"}</span>
          )}
        </div>

        {/* OUTPUT (right) */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Output</span>
            {slot.creditsUsed > 0 && <span className="text-[10px] text-muted-foreground">{slot.creditsUsed} cr</span>}
          </div>
          <div className="grid gap-2">
            {outputNodes.map((node) => {
              const st = slot.nodeStates[node.id]
              const out = st?.output
              const u = outputUrl(out)
              return (
                <OutputCard
                  key={node.id}
                  nodeId={node.id}
                  label={getNodeLabel(node)}
                  outputType={getOutputType(node.type)}
                  status={toOutputStatus(st?.status, slot.executionStatus)}
                  url={u}
                  text={out?.text as string | undefined}
                  onOpenMedia={u ? openResult : undefined}
                  progress={isRunning ? combinedProgress[node.id] : undefined}
                />
              )
            })}
          </div>

          {chips.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span key={c.nodeId} className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${chipClass(c.status)}`}>
                  {c.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />}
                  {c.label}
                  {c.status === "completed" ? " ✓" : c.status === "failed" ? " ✕" : ""}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {isRunning && (
              <button type="button" onClick={onStop} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700">
                <Square className="h-3 w-3" fill="currentColor" /> Stop
              </button>
            )}
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
            <div className="grid gap-2 border-t border-border pt-2">
              {chips.map((c) => {
                const node = nodes.find((n) => n.id === c.nodeId)
                const out = slot.nodeStates[c.nodeId]?.output
                const u = outputUrl(out)
                return (
                  <OutputCard
                    key={c.nodeId}
                    nodeId={c.nodeId}
                    label={c.label}
                    outputType={node ? getOutputType(node.type) : "text"}
                    status={toOutputStatus(c.status, slot.executionStatus)}
                    url={u}
                    text={out?.text as string | undefined}
                    onOpenMedia={u ? openResult : undefined}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
