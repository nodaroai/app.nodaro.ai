"use client"

import { memo, useState, useRef, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Sparkles, Loader2, AlertCircle, X, FileText, Square } from "lucide-react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import { getAIWriterTemplate } from "@/lib/ai-writer-templates"
import { generateAIWriterStream } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import type { AIWriterNodeData } from "@/types/nodes"

function WriterPreviewModal({
  isOpen,
  onClose,
  text,
  templateLabel,
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly text: string
  readonly templateLabel: string
}) {
  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-background rounded-lg border border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">AI Agent Output</span>
            {templateLabel && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {templateLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{text}</p>
        </div>
      </div>
    </div>,
    document.body
  )
}

function AIWriterNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AIWriterNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeText = activeResult?.text ?? nodeData.generatedText
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const credits = useModelCredits("ai-writer", 2)
  const template = getAIWriterTemplate(nodeData.templateId)
  const { user } = useAuth()
  const listTotal = (nodeData as Record<string, unknown>).__listTotal as number | undefined
  const listCompleted = (nodeData as Record<string, unknown>).__listCompleted as number | undefined
  const isNodeRunning = nodeData.executionStatus === "running"
  const listProgressPercent = (listTotal && listTotal > 0 && listCompleted !== undefined)
    ? Math.round((listCompleted / listTotal) * 100)
    : undefined

  // Streaming state -- tokens are written to the Zustand store (generatedText)
  // so that both the node card and the config panel can display them.
  const [isStreaming, setIsStreaming] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const accumulatedTextRef = useRef("")
  const flushTimerRef = useRef<number | null>(null)

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedText: newResults[newActiveIndex]?.text,
    })
  }

  const handleStreamingRun = useCallback(async () => {
    const store = useWorkflowStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (!node) return
    const writerData = node.data as AIWriterNodeData

    if (!user?.id) {
      toast.error("You must be logged in to run AI Agent")
      return
    }

    if (!writerData.systemPrompt?.trim()) {
      toast.error(`Node "${writerData.label}": no system prompt provided`)
      return
    }

    // Resolve connected text input or fall back to config panel userInput
    const edges = store.edges.filter((e) => e.target === id)
    const sourceNodes = edges
      .map((e) => store.nodes.find((n) => n.id === e.source))
      .filter((n): n is typeof store.nodes[number] => !!n)

    let userInput = writerData.userInput
    for (const src of sourceNodes) {
      if (src.type === "text-prompt") {
        const srcData = src.data as Record<string, unknown>
        const text = srcData.text as string | undefined
        if (text?.trim()) {
          userInput = text
          break
        }
      }
    }

    if (!userInput?.trim()) {
      toast.error(`Node "${writerData.label}": no input provided`)
      return
    }

    // Process system prompt
    const processedPrompt = writerData.systemPrompt

    // Set up abort controller
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Begin streaming -- clear old text and set activeResultIndex to -1 so
    // the node card and config panel display generatedText (streaming tokens)
    // instead of a stale previous result.
    setIsStreaming(true)
    accumulatedTextRef.current = ""
    updateNodeData(id, {
      executionStatus: "running",
      errorMessage: undefined,
      generatedText: "",
      activeResultIndex: -1,
    })

    try {
      const result = await generateAIWriterStream({
        systemPrompt: processedPrompt,
        userInput,
        model: writerData.model || "claude-sonnet-4-5-20250929",
        temperature: writerData.temperature ?? 0.7,
        maxTokens: writerData.maxTokens ?? 4096,
        userId: user.id,
        signal: controller.signal,
        onToken: (token) => {
          // Accumulate in ref (synchronous, no overhead) and flush to
          // Zustand store at ~60fps via requestAnimationFrame so both the
          // node card and config panel re-render with streaming text.
          accumulatedTextRef.current += token
          if (flushTimerRef.current === null) {
            flushTimerRef.current = requestAnimationFrame(() => {
              flushTimerRef.current = null
              updateNodeData(id, { generatedText: accumulatedTextRef.current })
            })
          }
        },
      })

      // Finalize: save result same as workflow-editor pattern
      const finalText = result.generatedText
      const freshNode = useWorkflowStore.getState().nodes.find((n) => n.id === id)
      const existingResults = ((freshNode?.data) as AIWriterNodeData | undefined)?.generatedResults ?? []
      const newResult = { text: finalText, jobId: result.jobId, timestamp: new Date().toISOString() }

      const items = [finalText]

      updateNodeData(id, {
        executionStatus: "completed",
        generatedText: finalText,
        generatedItems: items,
        generatedResults: [newResult, ...existingResults],
        activeResultIndex: 0,
      })
      toast.success(`AI Agent completed: ${items.length} item${items.length !== 1 ? "s" : ""} generated`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Generation failed"
      updateNodeData(id, {
        executionStatus: "failed",
        errorMessage: message,
      })
      toast.error(`AI Agent failed: ${message}`)
    } finally {
      // Cancel any pending rAF flush
      if (flushTimerRef.current !== null) {
        cancelAnimationFrame(flushTimerRef.current)
        flushTimerRef.current = null
      }
      setIsStreaming(false)
      accumulatedTextRef.current = ""
      abortControllerRef.current = null
    }
  }, [id, user?.id, updateNodeData])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  // activeText derives from generatedText in the store, which is updated
  // during streaming (via rAF flushes) and after completion.
  const displayText = activeText
  const truncatedText = displayText && displayText.length > 100
    ? `${displayText.substring(0, 100)}...`
    : displayText

  return (
    <>
      <div className="relative group/run">
        <BaseNode
          id={id}
          label={nodeData.label}
          icon={<Sparkles className="h-4 w-4" />}
          category="ai"
          credits={credits}
          selected={selected}
          isRunning={status === "running"}
          listCount={listTotal}
          listProgress={isNodeRunning && listTotal ? `${listCompleted ?? 0}/${listTotal}` : undefined}
          listProgressPercent={isNodeRunning ? listProgressPercent : undefined}
          handles={[
            { id: "in", type: "target", position: Position.Left, label: "Input" },
            { id: "text", type: "source", position: Position.Right, label: "Text" },
          ]}
        >
          <div className="flex flex-col gap-1">
            {/* Template badge */}
            {template && template.id !== "custom" && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium">
                  {template.label}
                </span>
              </div>
            )}

            {status === "running" && !displayText && (
              <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {displayText && (
              <div className="relative group">
                <div
                  className="w-full rounded-md bg-muted/30 p-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!isStreaming) setPreviewOpen(true)
                  }}
                >
                  <p className="text-xs text-foreground/80 line-clamp-3">
                    {truncatedText}
                    {isStreaming && <span className="animate-pulse">|</span>}
                  </p>
                  {!isStreaming && displayText.length > 100 && (
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Click to expand
                    </span>
                  )}
                </div>
                {status === "running" && !isStreaming && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {results.length > 0 && !isStreaming && (
                  <button
                    type="button"
                    aria-label="Remove" className="absolute -top-1 -right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirm(activeIndex)
                    }}
                    title="Delete this result"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {status === "failed" && !displayText && (
              <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">Failed</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}

            {status !== "running" && !displayText && status !== "failed" && (
              <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <FileText className="w-5 h-5" />
              </div>
            )}

            {results.length > 1 && !isStreaming && (
              <div className="flex gap-1 overflow-x-auto">
                {results.slice(0, 5).map((r, i) => (
                  <div key={`result-${i}`} className="relative group/thumb shrink-0">
                    <button
                      type="button"
                      aria-label={`Result ${i + 1}`}
                      className={`w-8 h-8 flex items-center justify-center rounded cursor-pointer transition-opacity ${
                        i === activeIndex
                          ? "opacity-100 ring-2 ring-primary bg-primary/20"
                          : "opacity-50 hover:opacity-80 bg-muted"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        updateNodeData(id, { activeResultIndex: i, generatedText: r.text })
                      }}
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm(i)
                      }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Stop button while streaming */}
            {isStreaming && (
              <button
                type="button"
                className="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-medium transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  handleStop()
                }}
              >
                <Square className="w-3 h-3" />
                Stop
              </button>
            )}

            <div className="flex justify-between text-muted-foreground">
              <span>{nodeData.provider || "gemini"}</span>
              <span>{template?.label ?? "Custom"}</span>
            </div>
          </div>
        </BaseNode>
        <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={handleStreamingRun} />
        <DeleteConfirmationDialog
          isOpen={deleteConfirm !== null}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => {
            if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
          }}
        />
      </div>
      <WriterPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        text={displayText ?? ""}
        templateLabel={template?.label ?? "Custom"}
      />
    </>
  )
}

export const AIWriterNode = memo(AIWriterNodeComponent)
