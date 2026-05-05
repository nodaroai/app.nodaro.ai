"use client"

import { memo, useState } from "react"
import { createPortal } from "react-dom"
import { Position, type NodeProps } from "@xyflow/react"
import { MessageSquare, Type, Loader2, AlertCircle, X, FileText, Copy, Download, BookOpen, AlignLeft } from "lucide-react"
import { computeDeleteResultUpdates, copyToClipboard, downloadTextFile } from "@/lib/utils"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { LLMChatData } from "@/types/nodes"

function LLMChatNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LLMChatData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeText = activeResult?.text ?? nodeData.generatedText
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null)
  const [showRuns, setShowRuns] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const credits = useModelCredits(buildLlmCreditIdentifier("llm-chat", nodeData.llmModel || LLM_FEATURE_DEFAULTS["llm-chat"]), 3)

  // Group results by runId
  const runGroups: Map<string, typeof results> = new Map()
  for (const r of results) {
    const rid = ((r as Record<string, unknown>).runId as string) ?? 'manual'
    if (!runGroups.has(rid)) runGroups.set(rid, [])
    runGroups.get(rid)!.push(r)
  }
  const runEntries = Array.from(runGroups.entries()) // oldest first
  const latestRunId = runEntries[runEntries.length - 1]?.[0] ?? null
  const effectiveRunId = activeRunId ?? latestRunId
  const activeRunResults = effectiveRunId ? (runGroups.get(effectiveRunId) ?? results) : results

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedText", "text"))
  }

  return (
    <div className="relative" style={{ maxWidth: '280px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<MessageSquare className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<MessageSquare className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={260}
        minHeight={180}
        hideHeader
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "prompt", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "references", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 50px)', left: '-29px' }, hideHandle: true },
          { id: "system-prompt", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 80px)', left: '-29px' }, hideHandle: true },
          { id: "text", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        <div className="flex flex-col gap-1 h-full">
            <>
          {status === "running" && !activeText && (
            <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {activeText && (
            <div className="relative group flex-1 flex flex-col">
              <div className="w-full rounded-md bg-muted/20 p-3 flex-1 flex flex-col">
                <div className="overflow-y-auto flex-1 pr-1" style={{ maxHeight: '200px' }}>
                  <p className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
                    {activeText}
                  </p>
                </div>
              </div>
              {status === "running" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Copy text"
                  className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(activeText ?? "", "Text copied")
                  }}
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  aria-label="Download"
                  className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadTextFile(activeText ?? "", `${nodeData.label || "llm-chat"}.txt`)
                  }}
                >
                  <Download className="w-3 h-3" />
                </button>
                {results.length > 0 && (
                  <button
                    type="button"
                    aria-label="Remove"
                    className="w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full"
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
            </div>
          )}

          {status === "failed" && !activeText && (
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

          {status !== "running" && !activeText && status !== "failed" && (
            <div className="flex items-center justify-center py-6 text-muted-foreground/40">
              <span className="text-xs">No output yet</span>
            </div>
          )}

          {results.length > 0 && (
            <div className="flex flex-col gap-1">
              {/* Run selector */}
              {showRuns && runEntries.length > 1 && (
                <div className="flex gap-1 overflow-x-auto pb-0.5">
                  {runEntries.map(([rid, runResults], idx) => (
                    <button
                      key={rid}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveRunId(rid)
                        const firstResult = runResults[0]
                        const globalIdx = results.indexOf(firstResult)
                        if (globalIdx >= 0) updateNodeData(id, { activeResultIndex: globalIdx, generatedText: firstResult.text })
                      }}
                      className={`shrink-0 text-[9px] px-2 py-1 rounded-md transition-colors ${
                        rid === effectiveRunId
                          ? "bg-primary/25 text-primary ring-1 ring-primary/50"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Run {idx + 1} · {runResults.length}
                    </button>
                  ))}
                </div>
              )}
              {/* Iteration thumbnails for active run */}
              <div className="flex gap-1 overflow-x-auto">
                {activeRunResults.slice(0, 5).map((r) => {
                  const globalIdx = results.indexOf(r)
                  return (
                    <div key={`result-${globalIdx}`} className="relative group/thumb shrink-0">
                      <button
                        type="button"
                        aria-label={`Result ${globalIdx + 1}`}
                        className={`w-8 h-8 flex items-center justify-center rounded cursor-pointer transition-opacity ${
                          globalIdx === activeIndex
                            ? "opacity-100 ring-2 ring-primary bg-primary/20"
                            : "opacity-50 hover:opacity-80 bg-muted"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          updateNodeData(id, { activeResultIndex: globalIdx, generatedText: r.text })
                        }}
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove"
                        className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteConfirm(globalIdx)
                        }}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )
                })}
                {activeRunResults.length > 5 && (
                  <span className="text-[9px] text-muted-foreground/40 self-center pl-1">+{activeRunResults.length - 5}</span>
                )}
              </div>
            </div>
          )}

          {(activeText || results.length > 0) && (
            <div className="flex items-center justify-between gap-1 px-1 pt-1">
              <span className="text-[10px] text-muted-foreground/50">{nodeData.llmModel || "default"}</span>
              <div className="flex items-center gap-1">
                {runEntries.length > 1 && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setShowRuns(v => !v) }}
                    className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${showRuns ? "bg-muted text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
                    title="Toggle run selector"
                  >
                    {runEntries.length} runs
                  </button>
                )}
                {results.length > 0 && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setShowLog(true) }}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-primary/15 hover:bg-primary/25 text-primary transition-colors"
                  >
                    <FileText className="w-3 h-3" />
                    <span>Log · {results.length}</span>
                  </button>
                )}
              </div>
            </div>
          )}
            </>
        </div>
      </BaseNode>
      {/* Input handle icons */}
      <HandleIcon icon={<Type />} color="pink" side="left" top="calc(100% - 20px)" label="prompt" />
      <HandleIcon icon={<BookOpen />} color="pink" side="left" top="calc(100% - 50px)" label="refs" />
      <HandleIcon icon={<AlignLeft />} color="pink" side="left" top="calc(100% - 80px)" label="system" />
      {/* Output handle icon */}
      <HandleIcon icon={<Type />} color="pink" side="right" top="20px" />
      {showLog && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => { setShowLog(false); setExpandedLogIndex(null) }}
        >
          <div
            className="relative bg-[#0f0f11] border border-white/10 rounded-2xl shadow-2xl flex flex-col"
            style={{ width: '860px', maxHeight: '85vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Execution Log</p>
                  <p className="text-[11px] text-muted-foreground">{nodeData.label} · {results.length} result{results.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowLog(false); setExpandedLogIndex(null) }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-3">
              {(() => {
                // Group results by runId
                const groups: Map<string, typeof results> = new Map()
                for (const r of [...results].reverse()) {
                  const rid = ((r as Record<string, unknown>).runId as string) ?? 'manual'
                  if (!groups.has(rid)) groups.set(rid, [])
                  groups.get(rid)!.push(r)
                }
                const groupEntries = Array.from(groups.entries())
                return groupEntries.map(([rid, groupResults], groupIdx) => (
                  <div key={rid} className="rounded-xl border border-white/8 overflow-hidden">
                    {/* Run header */}
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-white/5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Run {groupEntries.length - groupIdx}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">·</span>
                      <span className="text-[10px] text-muted-foreground/50">{groupResults.length} iteration{groupResults.length !== 1 ? 's' : ''}</span>
                    </div>
                    {/* Iterations */}
                    <div className="divide-y divide-white/5">
                      {groupResults.map((r, iterIdx) => {
                        const globalIdx = results.indexOf(r)
                        const isExpanded = expandedLogIndex === globalIdx
                        const sys = (r as Record<string, unknown>).systemPrompt as string | undefined
                        const usr = (r as Record<string, unknown>).userPrompt as string | undefined
                        return (
                          <div
                            key={iterIdx}
                            className="cursor-pointer hover:bg-white/3 transition-colors"
                            onClick={() => setExpandedLogIndex(isExpanded ? null : globalIdx)}
                          >
                            {/* Collapsed row */}
                            <div className="flex items-center gap-3 px-4 py-3">
                              <span className="text-[10px] tabular-nums text-muted-foreground/40 w-5 shrink-0">{iterIdx + 1}</span>
                              <div className="flex-1 min-w-0 grid grid-cols-3 gap-3">
                                <p className="text-[11px] truncate" style={{ color: '#a5b4fc' }}>{sys || '—'}</p>
                                <p className="text-[11px] truncate" style={{ color: '#6ee7b7' }}>{usr || '—'}</p>
                                <p className="text-[11px] truncate text-foreground/70">{r.text}</p>
                              </div>
                              <div className={`w-4 h-4 shrink-0 text-muted-foreground/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6l4 4 4-4"/></svg>
                              </div>
                            </div>
                            {/* Expanded content */}
                            {isExpanded && (
                              <div className="px-4 pb-4 grid grid-cols-3 gap-4">
                                <div className="rounded-lg p-3 overflow-y-auto" style={{ background: '#818cf810', maxHeight: '300px' }}>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#818cf8' }}>System Prompt</p>
                                    {sys && <button type="button" onClick={() => copyToClipboard(sys, "Copied")} className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-0.5"><Copy className="w-2.5 h-2.5" />Copy</button>}
                                  </div>
                                  <p className="text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: '#a5b4fc' }}>{sys || '—'}</p>
                                </div>
                                <div className="rounded-lg p-3 overflow-y-auto" style={{ background: '#34d39910', maxHeight: '300px' }}>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#34d399' }}>User Prompt</p>
                                    {usr && <button type="button" onClick={() => copyToClipboard(usr, "Copied")} className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-0.5"><Copy className="w-2.5 h-2.5" />Copy</button>}
                                  </div>
                                  <p className="text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: '#6ee7b7' }}>{usr || '—'}</p>
                                </div>
                                <div className="rounded-lg p-3 bg-white/5 overflow-y-auto" style={{ maxHeight: '300px' }}>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Output</p>
                                    {r.text && <button type="button" onClick={() => copyToClipboard(r.text, "Copied")} className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-0.5"><Copy className="w-2.5 h-2.5" />Copy</button>}
                                  </div>
                                  <p className="text-[11px] whitespace-pre-wrap leading-relaxed text-foreground/80">{r.text}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />
    </div>
  )
}

export const LLMChatNode = memo(LLMChatNodeComponent)
