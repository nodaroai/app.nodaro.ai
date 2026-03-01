"use client"

import { memo, useState, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Loader2, AlertCircle, X, Scissors, Settings, LayoutGrid, Expand, Download } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
const ExtractReferencesModal = lazy(() => import("@/components/editor/extract-references-modal").then(m => ({ default: m.ExtractReferencesModal })))
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { CachedImage } from "@/components/ui/cached-image"
import { useCanvasZoom } from "@/components/editor/canvas-zoom-context"

import { useModelCredits } from "@/hooks/use-model-credits"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { GenerateImageData, ExtractedReference } from "@/types/nodes"

function GenerateImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateImageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  // Check multiple possible URL fields for robustness (match Image to Video thumbnail logic)
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl ?? (nodeData as Record<string, unknown>).url as string | undefined
  // Treat empty strings as undefined (falsy check)
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined
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
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedImageUrl: newResults[newActiveIndex]?.url,
    })
  }

  return (
    <div className="relative">
    {/* Floating label above node */}
    <div className="absolute -top-6 left-0 flex items-center gap-1.5 text-[12px] font-medium text-white/70 pointer-events-none select-none">
      <ImageIcon className="w-3.5 h-3.5" />
      <span className="truncate">{nodeData.label}</span>
    </div>
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      listCount={listTotal}
      listProgress={isNodeRunning && listTotal ? `${listCompleted ?? 0}/${listTotal}` : undefined}
      listProgressPercent={isNodeRunning ? listProgressPercent : undefined}
      hideHeader
      bottomToolbarContent={
        results.length > 1 && showThumbnails ? (
          <div className="flex gap-1 bg-black/70 backdrop-blur-sm rounded-lg px-1.5 py-1">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <CachedImage
                  src={r.url}
                  alt={`Result ${i + 1}`}
                  className={`w-16 h-16 object-cover rounded cursor-pointer border border-white/20 ${
                    i === activeIndex
                      ? "opacity-100 ring-2 ring-white"
                      : "opacity-60 hover:opacity-90"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url })
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove"
                  className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
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
        ) : undefined
      }
      toolbarActions={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "in", type: "target", position: Position.Left, top: "calc(75% + 33px)", customStyle: { top: 'calc(75% + 33px)', left: '-3px' } },
        { id: "image", type: "source", position: Position.Right, customStyle: { top: 'calc(25% - 33px)', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="relative w-full group" style={{ minHeight: 180 }}>
        {/* Running state */}
        {status === "running" && (
          <div className="flex items-center justify-center bg-muted/30 rounded-xl" style={{ minHeight: 180 }}>
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
              className="w-full object-cover rounded-xl cursor-pointer"
              style={{ minHeight: 180 }}
              thumbnail={!useFull}
              thumbnailWidth={320}
              onClick={(e) => { e.stopPropagation(); selectNode(id) }}
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
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 p-2" style={{ minHeight: 180 }}>
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {/* Idle/empty state */}
        {status !== "running" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40" style={{ minHeight: 180 }}>
            <ImageIcon className="w-10 h-10" />
          </div>
        )}
      </div>
    </BaseNode>
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
