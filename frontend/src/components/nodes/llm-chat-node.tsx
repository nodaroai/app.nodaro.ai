"use client"

import { memo, useMemo, useState, Suspense } from "react"
import { createPortal } from "react-dom"
import { Position, type NodeProps } from "@xyflow/react"
import { MessageSquare, Type, Loader2, AlertCircle, X, FileText, Copy, Download, BookOpen, ImageIcon, List, LayoutGrid, LayoutTemplate, Sparkles, Braces, Eye } from "lucide-react"
import { computeDeleteResultUpdates, copyToClipboard, downloadTextFile } from "@/lib/utils"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { BaseNode } from "./base-node"
import { LlmChatQuickToolbar } from "./llm-chat-quick-toolbar"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidLlmChatConnection } from "@/lib/audio-text-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS, LLM_MODELS } from "@nodaro/shared"
import { getGenerateTextTemplate, GENERATE_TEXT_TEMPLATES } from "@/lib/generate-text-templates"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { LLMChatData } from "@/types/nodes"

const isVisualPicker = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT        = (t: string) => isValidLlmChatConnection("prompt",        t, isVisualPicker)
const ACCEPTS_REFERENCES    = (t: string) => isValidLlmChatConnection("references",    t, isVisualPicker)
const ACCEPTS_SYSTEM_PROMPT = (t: string) => isValidLlmChatConnection("system-prompt", t, isVisualPicker)

/** Resolve an LLM model id to its display name (falls back to the raw id). */
function llmModelLabel(id: string | undefined): string | undefined {
  if (!id) return undefined
  return LLM_MODELS.find((m) => m.id === id)?.displayName ?? id
}

/** If the output is a JSON object/array (optionally wrapped in a ```json
 *  fence), return the parsed value so the rendered view can show a colored
 *  object tree; otherwise `undefined` (→ render as Markdown). Lightweight —
 *  no heavy imports, safe to run on every render. */
function tryParseLlmJson(text: string | undefined): unknown {
  if (!text) return undefined
  let t = text.trim()
  const fence = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) t = fence[1].trim()
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined
  try {
    const v = JSON.parse(t)
    return typeof v === "object" && v !== null ? v : undefined
  } catch {
    return undefined
  }
}

// Lazy — keeps `react-markdown` out of the editor's main bundle; only loads
// when the user toggles the rendered (Markdown / JSON) view.
const LlmOutputView = lazyWithRetry(() =>
  import("./llm-output-view").then((m) => ({ default: m.LlmOutputView })),
)

// Result-card action-strip button styles — ghost icon buttons that sit on the
// muted result surface (replaces the former black-overlay buttons).
const STRIP_BTN =
  "shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
const STRIP_DELETE_BTN =
  "shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-white hover:bg-red-500 transition-colors"
const SHOW_OUTPUTS_BTN =
  "shrink-0 h-6 px-1.5 inline-flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
const SHOW_OUTPUTS_BTN_ACTIVE =
  "shrink-0 h-6 px-1.5 inline-flex items-center gap-1 rounded-md bg-[#ff0073] text-white hover:bg-[#ff0073]/90 transition-colors"

function LLMChatNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LLMChatData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeText = activeResult?.text ?? nodeData.generatedText
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const userTextTemplates = useWorkflowStore((s) => s.userTextTemplates) ?? []
  const [toolbarDropdownOpen, setToolbarDropdownOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null)
  // "Show outputs" toggle for the multi-result thumbnail strip — mirrors
  // Generate Image (off by default; revealed via the toolbar button).
  const [showThumbnails, setShowThumbnails] = useState(false)
  // Output rendering: "raw" (plain text, preserves formatting) vs "rendered"
  // (colored JSON object view when the output is JSON, else Markdown).
  const [outputView, setOutputView] = useState<"raw" | "rendered">("raw")
  const jsonValue = useMemo(() => tryParseLlmJson(activeText), [activeText])
  const isJsonOutput = jsonValue !== undefined
  const credits = useModelCredits(buildLlmCreditIdentifier("llm-chat", nodeData.llmModel || LLM_FEATURE_DEFAULTS["llm-chat"]), 3)
  const template = getGenerateTextTemplate(nodeData.templateId ?? "")

  // Per-result model + template — what actually produced the active result
  // (recorded at generation time; older results may lack these fields).
  const activeModelLabel = llmModelLabel(activeResult?.model)
  const activeTemplateId = activeResult?.templateId
  const activeTemplateLabel =
    activeTemplateId && activeTemplateId !== "custom"
      ? [...GENERATE_TEXT_TEMPLATES, ...userTextTemplates].find((t) => t.id === activeTemplateId)?.label ?? activeTemplateId
      : undefined

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
        minHeight={200}
        hideHeader
        enableZoomHandle
        keepTopToolbarVisible={toolbarDropdownOpen}
        rawToolbarContent={
          <LlmChatQuickToolbar
            nodeId={id}
            data={nodeData}
            credits={credits}
            isRunning={status === "running"}
            onAnyOpenChange={setToolbarDropdownOpen}
          />
        }
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <ResultsThumbnailsPanel
              results={results}
              activeIndex={activeIndex}
              mediaType="text"
              nodeSelected={!!selected || isSettingsOpen}
              onSelect={(i) => updateNodeData(id, { activeResultIndex: i, generatedText: results[i].text })}
              onDelete={(i) => setDeleteConfirm(i)}
            />
          ) : undefined
        }
        handles={[
          { id: "prompt",        type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "references",    type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
          { id: "system-prompt", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 88px)', left: '-29px' }, external: true },
          { id: "text",          type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
          { id: "items",         type: "source", position: Position.Right, customStyle: { top: '56px',              right: '-29px' }, external: true },
        ]}
      >
        <div className="flex flex-col gap-1 h-full min-h-0">
          {/* Configured template badge — shown only before any result exists.
              Once a result is displayed, the per-result model/template strip
              inside the result card takes over (the result records what
              actually produced it, which may differ from the current config). */}
          {!activeText && template && template.id !== "custom" && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium">
                {template.label}
              </span>
            </div>
          )}

          {status === "running" && !activeText && (
            <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {activeText && (
            <div className="relative group flex-1 flex flex-col min-h-0">
              <div className="w-full rounded-md bg-muted/20 flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* Action strip: copy / download / log on the LEFT; the
                    "show outputs" toggle and the delete (X) on the RIGHT. */}
                <div className="flex items-center gap-0.5 px-1 pt-1 pb-0.5 shrink-0">
                  <button
                    type="button"
                    aria-label={
                      outputView === "rendered"
                        ? "Show raw text"
                        : isJsonOutput
                          ? "View as JSON"
                          : "View as Markdown"
                    }
                    title={
                      outputView === "rendered"
                        ? "Show raw text"
                        : isJsonOutput
                          ? "View as JSON"
                          : "View as Markdown"
                    }
                    aria-pressed={outputView === "rendered"}
                    className={outputView === "rendered" ? SHOW_OUTPUTS_BTN_ACTIVE : STRIP_BTN}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOutputView((v) => (v === "rendered" ? "raw" : "rendered"))
                    }}
                  >
                    {isJsonOutput ? <Braces className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    aria-label="Copy text"
                    title="Copy text"
                    className={STRIP_BTN}
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(activeText ?? "", "Text copied")
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Download"
                    title="Download"
                    className={STRIP_BTN}
                    onClick={(e) => {
                      e.stopPropagation()
                      downloadTextFile(activeText ?? "", `${nodeData.label || "llm-chat"}.txt`)
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  {results.length > 0 && (
                    <button
                      type="button"
                      aria-label="Open log"
                      title="Execution log"
                      className={STRIP_BTN}
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowLog(true)
                      }}
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div className="flex-1 min-w-0" />
                  {results.length > 1 && (
                    <button
                      type="button"
                      aria-label={showThumbnails ? "Hide outputs" : "Show outputs"}
                      title={showThumbnails ? "Hide outputs" : "Show outputs"}
                      aria-pressed={showThumbnails}
                      className={showThumbnails ? SHOW_OUTPUTS_BTN_ACTIVE : SHOW_OUTPUTS_BTN}
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowThumbnails((v) => !v)
                      }}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-semibold tabular-nums">{results.length}</span>
                    </button>
                  )}
                  {results.length > 0 && (
                    <button
                      type="button"
                      aria-label="Remove"
                      title="Delete this result"
                      className={STRIP_DELETE_BTN}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm(activeIndex)
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Per-result model + template — records what produced this
                    specific result (model id resolved to display name). */}
                {(activeModelLabel || activeTemplateLabel) && (
                  <div className="flex items-center gap-1 flex-wrap px-2 pb-1 shrink-0">
                    {activeModelLabel && (
                      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-muted-foreground font-medium">
                        <Sparkles className="w-2.5 h-2.5" />
                        {activeModelLabel}
                      </span>
                    )}
                    {activeTemplateLabel && (
                      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium">
                        <LayoutTemplate className="w-2.5 h-2.5" />
                        {activeTemplateLabel}
                      </span>
                    )}
                  </div>
                )}

                {/* Scrollable output — Radix ScrollArea, matching the Text
                    Prompt node's scrollbar look + behavior (height-driven, not
                    a fixed maxHeight, so the box tracks the node size). The
                    rendered view (Markdown / colored JSON) is lazy-loaded. */}
                <ScrollArea className="flex-1 min-h-0 w-full">
                  {outputView === "rendered" ? (
                    <Suspense
                      fallback={
                        <p className="text-xs text-muted-foreground px-3 pb-3 pt-0.5">Rendering…</p>
                      }
                    >
                      <LlmOutputView text={activeText} json={jsonValue} />
                    </Suspense>
                  ) : (
                    <p className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed px-3 pb-3 pt-0.5">
                      {activeText}
                    </p>
                  )}
                </ScrollArea>
              </div>
              {status === "running" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
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
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="llm-chat" handleId="prompt"        type="target" position={Position.Left}  label="Prompt"        color={TEXT_HANDLE_COLOR} icon={<Type />}      side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="llm-chat" handleId="references"    type="target" position={Position.Left}  label="References"    color={HANDLE_COLORS.reference} icon={<ImageIcon />} side="left"  top="calc(100% - 56px)" orderMatters accepts={ACCEPTS_REFERENCES} />
      <HandleWithPopover nodeId={id} nodeType="llm-chat" handleId="system-prompt" type="target" position={Position.Left}  label="Instructions" color={TEXT_HANDLE_COLOR} icon={<BookOpen />}  side="left"  top="calc(100% - 88px)" accepts={ACCEPTS_SYSTEM_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="llm-chat" handleId="text"          type="source" position={Position.Right} label="Text"          color={TEXT_HANDLE_COLOR} icon={<Type />}      side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="llm-chat" handleId="items"         type="source" position={Position.Right} label="Items"         color={HANDLE_COLORS.list} icon={<List />}      side="right" top="56px" />
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
                return groupEntries.map(([rid, groupResults], groupIdx) => {
                  // Model + template are recorded per result; within a run they
                  // are consistent, so read them off the first iteration.
                  const runModelLabel = llmModelLabel(groupResults[0]?.model)
                  const runTemplateId = groupResults[0]?.templateId
                  const runTemplateLabel =
                    runTemplateId && runTemplateId !== "custom"
                      ? [...GENERATE_TEXT_TEMPLATES, ...userTextTemplates].find((t) => t.id === runTemplateId)?.label ?? runTemplateId
                      : undefined
                  return (
                  <div key={rid} className="rounded-xl border border-white/8 overflow-hidden">
                    {/* Run header */}
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-white/5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Run {groupEntries.length - groupIdx}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">·</span>
                      <span className="text-[10px] text-muted-foreground/50">{groupResults.length} iteration{groupResults.length !== 1 ? 's' : ''}</span>
                      {runModelLabel && (
                        <span className="ml-auto inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground font-medium">
                          <Sparkles className="w-2.5 h-2.5" />
                          {runModelLabel}
                        </span>
                      )}
                      {runTemplateLabel && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium">
                          <LayoutTemplate className="w-2.5 h-2.5" />
                          {runTemplateLabel}
                        </span>
                      )}
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
                                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#818cf8' }}>Instructions</p>
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
                  )
                })
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
