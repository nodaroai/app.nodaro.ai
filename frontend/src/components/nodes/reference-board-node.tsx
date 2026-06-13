"use client"

import { memo, useState, lazy, Suspense } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import {
  LayoutGrid, Loader2, AlertCircle, X, Image as ImageIcon, Expand, Download, Link,
  Wand2, Brush, Plus, RefreshCw, Send,
} from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { ACCEPTS_ENTITY_REF } from "@/lib/target-handle-registry"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { imageNodeSizing } from "./video-node-defaults"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { CachedImage } from "@/components/ui/cached-image"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { NodeQuickStrip } from "./node-quick-strip"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { useUpstreamImageAspect } from "@/hooks/use-upstream-image-aspect"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"
import { EditableNodeLabel } from "./editable-node-label"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import { imageToImage, createReferenceBoard } from "@/lib/api"
import { pollImageRefineToNode } from "@/components/editor/workflow-editor/poll-job"
import type { ReferenceBoardData } from "@/types/nodes"

// Lazy-loaded mask painter — same pattern as image-configs.tsx. Its onSave
// uploads the brushed mask and hands back a ready-to-use R2 URL.
const MaskPainterModal = lazy(() =>
  import("@/components/editor/mask-painter-modal").then((m) => ({ default: m.MaskPainterModal })),
)

// Refine providers (both members of IMAGE_I2I_PROVIDERS):
const GLOBAL_EDIT_PROVIDER = "kontext-multi"   // cross-image edit, no mask
const MASKED_EDIT_PROVIDER = "ideogram-edit"   // mask_url + reference_image_urls

function ReferenceBoardNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ReferenceBoardData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined

  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)

  // ── Refine bar state ──────────────────────────────────────────────
  const [refineInstruction, setRefineInstruction] = useState("")
  const [maskMode, setMaskMode] = useState(false)
  const [extraRefs, setExtraRefs] = useState<readonly string[]>([])
  const [showMaskPainter, setShowMaskPainter] = useState(false)

  const isRunning = status === "running"

  const { aspectRatio: imgAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  const upstreamImageAspect = useUpstreamImageAspect(id)

  const creditModelId = buildCreditModelIdentifier(
    nodeData.provider ?? "nano-banana-pro",
    nodeData as unknown as Record<string, unknown>,
  )
  const credits = useModelCredits(creditModelId, 1)

  function handleDeleteResult(indexToDelete: number) {
    const updates = computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl")
    updateNodeData(id, updates)
  }

  // Reference URLs the user attached to the board, plus any the refine bar adds.
  const baseRefUrls = (nodeData.referenceImageUrls ?? []).map((r) => r.url).filter(Boolean)
  const refineRefUrls = [...baseRefUrls, ...extraRefs]

  // ── Re-roll: regenerate a fresh board with a new seed, keeping config. ──
  function handleReroll() {
    if (isRunning) return
    const newSeed = Math.floor(Math.random() * 2_000_000_000)
    void pollImageRefineToNode(
      id,
      () =>
        createReferenceBoard({
          provider: nodeData.provider ?? "nano-banana-pro",
          boardTemplate: nodeData.boardTemplate,
          prompt: nodeData.prompt?.trim() ? nodeData.prompt : undefined,
          negativePrompt: nodeData.negativePrompt || undefined,
          aspectRatio: nodeData.aspectRatio || undefined,
          resolution: nodeData.resolution,
          quality: nodeData.quality,
          seed: newSeed,
          referenceImageUrls: baseRefUrls.length ? baseRefUrls : undefined,
        }),
      "Re-roll board",
    )
  }

  // ── Global edit (no mask): cross-image instruction over the whole board. ──
  function handleGlobalEdit() {
    if (isRunning || !activeUrl || !refineInstruction.trim()) return
    const instruction = refineInstruction.trim()
    void pollImageRefineToNode(
      id,
      () =>
        imageToImage(
          activeUrl,
          instruction,
          GLOBAL_EDIT_PROVIDER,
          undefined, // userId comes from the session (route ignores body userId — IDOR-safe)
          refineRefUrls.length ? refineRefUrls : undefined,
          {},
        ),
      "Global edit",
    ).then(() => setRefineInstruction(""))
  }

  // ── Masked edit: open the painter; the actual job fires in onMaskSaved. ──
  function handleMaskedEdit() {
    if (isRunning || !activeUrl || !refineInstruction.trim()) return
    setShowMaskPainter(true)
  }

  // Mask painter already uploaded the brushed mask → we get a ready maskUrl.
  function onMaskSaved(maskUrl: string) {
    setShowMaskPainter(false)
    if (!activeUrl) return
    const instruction = refineInstruction.trim()
    void pollImageRefineToNode(
      id,
      () =>
        imageToImage(
          activeUrl,
          instruction,
          MASKED_EDIT_PROVIDER,
          undefined,
          refineRefUrls.length ? refineRefUrls : undefined,
          { maskUrl },
        ),
      "Masked edit",
    ).then(() => setRefineInstruction(""))
  }

  // ── + Ref: attach a reference image for the edit (pasted/typed URL). ──
  function handleAddRef() {
    const url = window.prompt("Reference image URL for this edit:")?.trim()
    if (url) setExtraRefs((prev) => [...prev, url])
  }

  // Apply runs the active mode (masked → painter, else global).
  function handleApplyRefine() {
    if (maskMode) handleMaskedEdit()
    else handleGlobalEdit()
  }

  const canRefine = !!activeUrl && !isRunning

  return (
    <div className="relative" style={{ width: "100%", height: "100%", minHeight: 220 }}>
      {/* Floating label above node */}
      <EditableNodeLabel
        label={nodeData.label}
        icon={<LayoutGrid className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<LayoutGrid className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={isRunning}
        {...imageNodeSizing(imgAspectRatio, upstreamImageAspect)}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={isRunning} />
        }
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <ResultsThumbnailsPanel
              results={results}
              activeIndex={activeIndex}
              nodeSelected={!!selected || isSettingsOpen}
              onSelect={(i) => updateNodeData(id, { activeResultIndex: i, generatedImageUrl: results[i].url })}
            />
          ) : undefined
        }
        handles={[
          { id: "references", type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "image",      type: "source", position: Position.Right, customStyle: { top: "24px",               right: "-29px" }, external: true },
        ]}
      >
        <div className="relative w-full h-full group flex flex-col">
          <div className="relative w-full flex-1 min-h-0">
            {/* Running state */}
            {isRunning && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {/* Image state */}
            {!isRunning && activeUrl && (
              <>
                {results.length > 1 && (
                  <button
                    type="button"
                    className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 backdrop-blur-sm border rounded-md z-10 transition-opacity ${
                      showThumbnails
                        ? "bg-[#ff0073] hover:bg-[#ff0073]/90 border-[#ff0073] text-white opacity-100"
                        : "bg-black/40 hover:bg-black/60 border-white/10 text-white opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                    title={showThumbnails ? "Hide versions" : "Show versions"}
                    aria-pressed={showThumbnails}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    <span className="text-[11px] font-medium">{results.length}</span>
                  </button>
                )}
                <CachedImage
                  src={activeUrl}
                  alt="Reference board"
                  className="w-full h-full object-cover rounded-xl"
                  thumbnail
                  thumbnailWidth={400}
                  onLoadDimensions={handleLoadDimensions}
                />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Expand preview"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
                    title="Fullscreen"
                  >
                    <Expand className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Download"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      const a = document.createElement('a')
                      a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl)}&download=1`
                      a.download = `${nodeData.label || 'reference-board'}.png`
                      a.click()
                    }}
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Copy URL"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(activeUrl, "URL copied")
                    }}
                    title="Copy URL"
                  >
                    <Link className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}

            {/* Failed state */}
            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 h-[180px] p-2">
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
            {!isRunning && !activeUrl && status !== "failed" && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px] px-3 text-center">
                <LayoutGrid className="w-10 h-10" />
                <span className="text-[10px] leading-tight">
                  Connect reference images or entities to generate a board
                </span>
              </div>
            )}
          </div>

          {/* ── Refine bar (only on a realized board) ──────────────── */}
          {activeUrl && (
            <div
              className="mt-1.5 flex flex-col gap-1 rounded-lg bg-black/30 border border-white/10 p-1.5 nodrag"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1">
                <Wand2 className="w-3.5 h-3.5 text-[#ff0073] shrink-0" />
                <input
                  type="text"
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleApplyRefine() }
                  }}
                  placeholder={maskMode ? "Edit inside the mask…" : "Edit the whole board…"}
                  disabled={!canRefine}
                  className="flex-1 min-w-0 bg-transparent text-[11px] text-white placeholder:text-white/30 outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleApplyRefine}
                  disabled={!canRefine || !refineInstruction.trim()}
                  title={maskMode ? "Brush a mask, then edit" : "Apply edit to whole board"}
                  className="w-6 h-6 flex items-center justify-center rounded-md bg-[#ff0073] text-white hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {maskMode ? <Brush className="w-3 h-3" /> : <Send className="w-3 h-3" />}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMaskMode((v) => !v)}
                  disabled={!canRefine}
                  aria-pressed={maskMode}
                  title={maskMode ? "Mask on — edit only the brushed area" : "Mask off — edit the whole board"}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] border transition-colors disabled:opacity-40 ${
                    maskMode
                      ? "bg-[#ff0073] border-[#ff0073] text-white"
                      : "bg-white/5 border-white/10 text-white/70 hover:text-white"
                  }`}
                >
                  <Brush className="w-3 h-3" /> Mask
                </button>
                <button
                  type="button"
                  onClick={handleAddRef}
                  disabled={!canRefine}
                  title="Attach a reference image for the edit"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] border bg-white/5 border-white/10 text-white/70 hover:text-white transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3 h-3" />
                  <ImageIcon className="w-3 h-3" />
                  {extraRefs.length > 0 ? <span>{extraRefs.length}</span> : null}
                </button>
                <button
                  type="button"
                  onClick={handleReroll}
                  disabled={isRunning}
                  title="Re-roll — generate a fresh board (new seed)"
                  className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] border bg-white/5 border-white/10 text-white/70 hover:text-white transition-colors disabled:opacity-40"
                >
                  <RefreshCw className="w-3 h-3" /> Re-roll
                </button>
              </div>
            </div>
          )}
        </div>
      </BaseNode>

      {/* Handles */}
      <HandleWithPopover nodeId={id} nodeType="reference-board" handleId="references" type="target" position={Position.Left}  label="References" color={HANDLE_COLORS.image}    icon={<ImageIcon />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_ENTITY_REF} />
      <HandleWithPopover nodeId={id} nodeType="reference-board" handleId="image"      type="source" position={Position.Right} label="Image"      color={HANDLE_COLORS.image}    icon={<ImageIcon />} side="right" top="24px" />

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={activeUrl}
          results={results}
          initialIndex={activeIndex}
        />
      )}
      {activeUrl && showMaskPainter && (
        <Suspense fallback={null}>
          <MaskPainterModal
            isOpen={showMaskPainter}
            onClose={() => setShowMaskPainter(false)}
            imageUrl={activeUrl}
            onSave={onMaskSaved}
          />
        </Suspense>
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

export const ReferenceBoardNode = memo(ReferenceBoardNodeComponent)
