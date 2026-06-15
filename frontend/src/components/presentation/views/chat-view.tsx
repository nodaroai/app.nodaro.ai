import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowUp, ChevronDown, ChevronUp, Download, ImagePlus, Loader2, Music, Play, RotateCcw, Video, X } from "lucide-react"
import { toast } from "sonner"
import { CachedImage } from "@/components/ui/cached-image"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { getNodeLabel, getOutputType } from "@/lib/presentation-utils"
import { ORIGINAL_SLOT_ID, type RunSlot, type RunSlotNodeState } from "@/components/app-runner/types"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { OutputStatus } from "../output-cards/shared"
import { OutputCard } from "../output-card"
import { buildStepChips, getThreadMessages, shouldExpandComposer, type StepChip } from "./chat-view-helpers"

/** Minimal slice of the useRunSlots API that ChatView consumes. */
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
  renderInputCard: (node: WorkflowNode, variant?: "composer") => ReactNode
  onOpenMedia?: (nodeId: string) => void
  runSlots?: ChatRunSlotsApi
  appName?: string
  appDescription?: string
}

const UPLOAD_TYPES = new Set(["upload-image", "upload-video", "upload-audio"])
const isUploadNode = (type?: string) => UPLOAD_TYPES.has(type ?? "")
const uploadAccept = (type?: string) =>
  type === "upload-video" ? "video/*" : type === "upload-audio" ? "audio/*" : "image/*"

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

function firstStringValue(v: Record<string, unknown> | undefined): string | undefined {
  if (!v) return undefined
  for (const val of Object.values(v)) {
    if (typeof val === "string" && val.trim()) return val.trim()
  }
  return undefined
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
  const inputValues = usePresentationStore((s) => s.inputValues)
  const updateInputValue = usePresentationStore((s) => s.updateInputValue)

  const isRunning = execStatus === "running" || execStatus === "loading"
  const slots = runSlots?.slots ?? []
  const messages = getThreadMessages(slots)

  // Uploads get bespoke composer treatment (thumbnail strip + footer add buttons);
  // everything else (text, pickers) renders as a compact input card.
  const uploadNodes = orderedInputNodes.filter((n) => isUploadNode(n.type))
  const otherNodes = orderedInputNodes.filter((n) => !isUploadNode(n.type))
  const attachments = uploadNodes
    .map((node) => ({ node, url: inputValues[node.id]?.url as string | undefined }))
    .filter((a) => !!a.url)

  const [lightbox, setLightbox] = useState<{ url: string; isVideo: boolean } | null>(null)

  // Adaptive composer expand for the non-upload card stack, session-persisted.
  const storageKey = `chat-composer-expanded:${appName ?? "app"}`
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved != null) return saved === "1"
    } catch { /* ignore */ }
    return shouldExpandComposer(otherNodes)
  })
  const toggleExpanded = () => {
    setExpanded((e) => {
      const next = !e
      try { sessionStorage.setItem(storageKey, next ? "1" : "0") } catch { /* ignore */ }
      return next
    })
  }

  // One run at a time (Option A): on terminal, mint the next draft (seeded) so users can iterate.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !isRunning && (execStatus === "completed" || execStatus === "failed")) {
      const active = runSlots?.activeSlotId
      if (active && active !== ORIGINAL_SLOT_ID) runSlots?.handleDuplicateSlot(active)
    }
    wasRunning.current = isRunning
  }, [isRunning, execStatus, runSlots])

  // Auto-scroll to the newest message.
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
      {/* Thread — intentionally WIDER than the composer */}
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
                combinedProgress={combinedProgress}
                onOpenMedia={onOpenMedia}
                onOpenLightbox={(url, isVideo) => setLightbox({ url, isVideo })}
                onReuse={() => runSlots?.handleDuplicateSlot(slot.id)}
                stepsExpanded={expandedSteps.has(slot.id)}
                onToggleSteps={() => toggleSteps(slot.id)}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer — narrower, centered bottom bar */}
      <div className="border-t border-border bg-card/40 px-3 sm:px-6 py-3 shrink-0">
        <div className="max-w-2xl mx-auto">
          <div className="relative rounded-2xl border border-border bg-background p-3">
            {otherNodes.length > 1 && (
              <button
                type="button"
                onClick={toggleExpanded}
                title={expanded ? "Collapse" : "Expand inputs"}
                className="absolute -top-3 right-4 h-6 w-6 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
            )}

            {/* Attachment thumbnail strip (above the input) */}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map(({ node, url }) => (
                  <ComposerThumb
                    key={node.id}
                    url={url!}
                    type={node.type}
                    disabled={isRunning}
                    onRemove={() => updateInputValue(node.id, "url", "")}
                    onOpen={() => setLightbox({ url: url!, isVideo: node.type === "upload-video" })}
                  />
                ))}
              </div>
            )}

            {/* Non-upload inputs (text, pickers) */}
            {otherNodes.length > 0 && (
              <div
                className={`flex flex-col gap-2 overflow-y-auto ${expanded ? "max-h-[40vh]" : "max-h-[140px]"} ${isRunning ? "pointer-events-none opacity-60" : ""}`}
              >
                {otherNodes.map((node) => (
                  <div key={node.id}>{renderInputCard(node, "composer")}</div>
                ))}
              </div>
            )}

            {/* Footer: add-attachment buttons (per empty upload) + Launch */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {uploadNodes
                  .filter((n) => !inputValues[n.id]?.url)
                  .map((node) => (
                    <ComposerUploadButton
                      key={node.id}
                      node={node}
                      disabled={isRunning}
                      onUploaded={(url) => updateInputValue(node.id, "url", url)}
                    />
                  ))}
              </div>
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

      {lightbox && (
        <Lightbox url={lightbox.url} isVideo={lightbox.isVideo} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

/** A composer attachment thumbnail: click → fullscreen, hover → × to remove. */
function ComposerThumb({
  url,
  type,
  onRemove,
  onOpen,
  disabled,
}: {
  url: string
  type?: string
  onRemove: () => void
  onOpen: () => void
  disabled?: boolean
}) {
  const isVideo = type === "upload-video"
  const isAudio = type === "upload-audio"
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="block h-16 w-16 overflow-hidden rounded-lg bg-muted/40"
        title="View"
      >
        {isAudio ? (
          <span className="flex h-full w-full items-center justify-center"><Music className="h-6 w-6 text-muted-foreground" /></span>
        ) : isVideo ? (
          <span className="relative block h-full w-full">
            <video src={url} className="h-full w-full object-cover" muted playsInline />
            <span className="absolute inset-0 flex items-center justify-center"><Play className="h-4 w-4 text-white drop-shadow" fill="white" /></span>
          </span>
        ) : (
          <CachedImage src={url} alt="" thumbnail thumbnailWidth={128} className="h-full w-full object-cover" />
        )}
      </button>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attachment"
          className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 text-muted-foreground ring-1 ring-border opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/** A footer "add attachment" button: opens a file picker, uploads, hands back the URL. */
function ComposerUploadButton({
  node,
  onUploaded,
  disabled,
}: {
  node: WorkflowNode
  onUploaded: (url: string) => void
  disabled?: boolean
}) {
  const { upload, isUploading } = useFileUpload()
  const inputRef = useRef<HTMLInputElement>(null)
  const Icon = node.type === "upload-video" ? Video : node.type === "upload-audio" ? Music : ImagePlus

  const handleFile = async (file?: File) => {
    if (!file) return
    try {
      const res = await upload(file)
      onUploaded(res.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={uploadAccept(node.type)}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void handleFile(f) }}
      />
      <button
        type="button"
        disabled={disabled || isUploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
      >
        {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
        {getNodeLabel(node)}
      </button>
    </>
  )
}

/** Click-to-fullscreen overlay for an attachment. */
function Lightbox({ url, isVideo, onClose }: { url: string; isVideo: boolean; onClose: () => void }) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-white/80 hover:text-white">
        <X className="h-6 w-6" />
      </button>
      {isVideo ? (
        <video src={url} controls autoPlay className="max-h-[90vh] max-w-[90vw] rounded-lg" onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={url} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
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
  onOpenMedia?: (nodeId: string) => void
  onOpenLightbox: (url: string, isVideo: boolean) => void
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
  onOpenLightbox,
  onReuse,
  stepsExpanded,
  onToggleSteps,
}: ChatMessageProps) {
  const chips = buildStepChips(nodes, edges, outputNodes.map((n) => n.id), slot.nodeStates)
  const isRunning = slot.executionStatus === "running"
  const isDone = slot.executionStatus === "completed"

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
                  onClick={() => onOpenLightbox(url!, node.type === "upload-video")}
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
    </div>
  )
}
