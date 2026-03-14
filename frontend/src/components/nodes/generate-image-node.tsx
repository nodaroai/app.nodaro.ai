"use client"

import { memo, useState, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Loader2, AlertCircle, ShieldAlert, X, Scissors, Settings, LayoutGrid, Expand, Download, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
const ExtractReferencesModal = lazy(() => import("@/components/editor/extract-references-modal").then(m => ({ default: m.ExtractReferencesModal })))
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { CachedImage } from "@/components/ui/cached-image"
import { useCanvasZoom } from "@/components/editor/canvas-zoom-context"

import { useModelCredits } from "@/hooks/use-model-credits"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"
import { EditableNodeLabel } from "./editable-node-label"
import type { GenerateImageData, ExtractedReference } from "@/types/nodes"

function GenerateImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateImageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const inConnectionCount = useConnectionCount(id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  // Check multiple possible URL fields for robustness (match Image to Video thumbnail logic)
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl ?? (nodeData as Record<string, unknown>).url as string | undefined
  // Treat empty strings as undefined (falsy check)
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined
  const isContentPolicy = status === "failed" && nodeData.errorMessage?.toLowerCase().includes("content policy")
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const attachedIds = nodeData.characterDefinitionIds ?? []
  const attachedCount = allCharDefs.filter((c) => attachedIds.includes(c.id)).length
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [extractOpen, setExtractOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [extractedRefs, setExtractedRefs] = useState<readonly ExtractedReference[]>([])
  const { zoom } = useCanvasZoom()
  const useFull = zoom >= 0.8
  const creditModelId = buildCreditModelIdentifier(
    nodeData.provider ?? "nano-banana",
    nodeData as unknown as Record<string, unknown>,
  )
  const credits = useModelCredits(creditModelId, 1)
  const listTotal = (nodeData as Record<string, unknown>).__listTotal as number | undefined
  const listCompleted = (nodeData as Record<string, unknown>).__listCompleted as number | undefined
  const isNodeRunning = nodeData.executionStatus === "running"
  const listProgressPercent = (listTotal && listTotal > 0 && listCompleted !== undefined)
    ? Math.round((listCompleted / listTotal) * 100)
    : undefined

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    const updates: Record<string, unknown> = {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedImageUrl: newResults[newActiveIndex]?.url,
    }
    // Keep __listResults in sync so the config panel's iteration results
    // panel reflects deletions.  Remove the deleted URL; clear all __list*
    // metadata when no results remain.
    const listResults = (nodeData as Record<string, unknown>).__listResults as string[] | undefined
    if (listResults) {
      const deletedUrl = results[indexToDelete]?.url
      const newListResults = deletedUrl
        ? listResults.filter((u) => u !== deletedUrl)
        : listResults
      if (newListResults.length <= 1) {
        updates.__listResults = undefined
        updates.__listInputs = undefined
        updates.__listTotal = undefined
        updates.__listCompleted = undefined
      } else {
        updates.__listResults = newListResults
        updates.__listTotal = newListResults.length
        updates.__listCompleted = newListResults.length
      }
    }
    updateNodeData(id, updates)
  }

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    {/* Floating label above node */}
    <EditableNodeLabel
      label={nodeData.label}
      icon={<ImageIcon className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      minWidth={220}
      minHeight={260}
      listCount={listTotal}
      listProgress={isNodeRunning && listTotal ? `${listCompleted ?? 0}/${listTotal}` : undefined}
      listProgressPercent={isNodeRunning ? listProgressPercent : undefined}
      hideHeader
      topToolbarContent={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      bottomToolbarContent={
        showThumbnails && results.length > 1 ? (
          <div className="flex gap-1.5 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
            {results.slice(0, 8).map((r, i) => (
              <CachedImage
                key={`${r.jobId}-${i}`}
                src={r.url}
                alt={`Result ${i + 1}`}
                className={`w-12 h-12 object-cover rounded-lg cursor-pointer transition-all ${
                  i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                }`}
                thumbnail
                thumbnailWidth={96}
                onClick={(e) => {
                  e.stopPropagation()
                  updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url })
                }}
              />
            ))}
          </div>
        ) : undefined
      }
      handles={[
        { id: "in", type: "target", position: Position.Left, top: "calc(75% + 33px)", customStyle: { top: 'calc(75% + 33px)', left: '-29px' }, hideHandle: true },
        { id: "image", type: "source", position: Position.Right, customStyle: { top: 'calc(25% - 33px)', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="relative w-full group">
        {/* Running state */}
        {status === "running" && (
          <div className="flex items-center justify-center bg-muted/30 rounded-xl h-[180px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Image state */}
        {status !== "running" && activeUrl && (
          <>
            {results.length > 1 && (
              <button
                type="button"
                className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-md z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                title="Show versions"
              >
                <LayoutGrid className="w-3 h-3" />
                <span className="text-[11px] font-medium">{results.length}</span>
              </button>
            )}
            <CachedImage
              src={activeUrl}
              alt="Generated"
              className="w-full object-cover rounded-xl"
              thumbnail={!useFull}
              thumbnailWidth={320}
            />
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label="Extract references"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setExtractOpen(true)
                }}
                title="Extract references"
              >
                <Scissors className="w-3.5 h-3.5" />
              </button>
              {results.length > 0 && (
                <button
                  type="button"
                  aria-label="Remove result"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(activeIndex)
                  }}
                  title="Delete this result"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              className="absolute bottom-2 left-2 w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
              title="Fullscreen"
            >
              <Expand className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-2 left-11 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); selectNode(id) }}
                title="Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              className="absolute bottom-2 left-20 w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                const a = document.createElement('a')
                a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`
                a.download = `${nodeData.label || 'image'}.png`
                a.click()
              }}
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-8 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <SaveToLibraryButton url={activeUrl} type="image" className="bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full" />
            </div>
          </>
        )}

        {/* Failed state */}
        {status === "failed" && !activeUrl && (
          <div className={`flex flex-col items-center justify-center gap-1 rounded-xl p-2 h-[180px] ${isContentPolicy ? "bg-amber-500/10 text-amber-500" : "bg-red-500/5 text-red-500"}`}>
            <div className="flex items-center gap-1.5">
              {isContentPolicy ? <ShieldAlert className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span className="font-medium">{isContentPolicy ? "Prohibited" : "Failed"}</span>
            </div>
            {(isContentPolicy || nodeData.errorMessage) && (
              <p className={`text-[10px] text-center line-clamp-2 ${isContentPolicy ? "text-amber-400" : "text-red-400"}`} title={nodeData.errorMessage}>
                {isContentPolicy ? "Blocked by provider safety filter. Try a different prompt or image." : nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {/* Idle/empty state */}
        {status !== "running" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
            <ImageIcon className="w-10 h-10" />
          </div>
        )}
      </div>
    </BaseNode>
    {/* Input handle icon (TYPE 1) */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(75% + 19px)', left: '-29px' }}
    >
      <Type className="w-3.5 h-3.5 text-white" />
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
      {inConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
          {inConnectionCount}
        </div>
      )}
    </div>
    {/* Image output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: 'calc(25% - 47px)', right: '-29px' }}
    >
      <ImageIcon className="w-3.5 h-3.5 text-white" />
    </div>
    {activeUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="image"
        url={activeUrl}
      />
    )}
    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />
    {activeUrl && extractOpen && (
      <Suspense fallback={null}>
        <ExtractReferencesModal
          isOpen={extractOpen}
          onClose={() => setExtractOpen(false)}
          imageUrl={activeUrl}
          sceneIndex={0}
          sceneCharacters={[]}
          existingReferences={extractedRefs}
          onSave={(refs) => {
            setExtractedRefs(refs)
            for (const ref of refs) {
              if (!ref.imageUrl) continue
              addCharacterDefinition({
                id: crypto.randomUUID(),
                name: ref.name,
                type: "reference",
                category: ref.type,
                referenceImageUrl: ref.imageUrl,
              })
            }
          }}
        />
      </Suspense>
    )}
    </div>
  )
}

export const GenerateImageNode = memo(GenerateImageNodeComponent)
