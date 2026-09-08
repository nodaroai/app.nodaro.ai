"use client"

import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { memo, useState, useCallback, useEffect } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import {
  Layers,
  LayoutGrid,
  Loader2,
  AlertCircle,
  X,
  Image as ImageIcon,
  Expand,
  Pencil,
  Download,
  Link,
  Plus,
  QrCode,
} from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidImageOverlayConnection } from "@/lib/image-producer-handles"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { imageNodeSizing } from "./video-node-defaults"
import { useUpstreamImageAspect } from "@/hooks/use-upstream-image-aspect"
import { NodeQuickStrip } from "./node-quick-strip"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useEstimatedCredits } from "@/hooks/use-estimated-credits"
import type { WorkflowNode } from "@/types/nodes"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { EditableNodeLabel } from "./editable-node-label"
import { ImageOverlayPreview } from "./image-overlay-preview"
import { useImageOverlayUpstream } from "@/hooks/use-image-overlay-upstream"
import { ImageOverlayEditor } from "./image-overlay-editor"
import { useImageOverlayLayers } from "@/hooks/use-image-overlay-layers"
import { OVERLAY_BASE_HANDLE_TOP, overlayAddButtonTop, overlayHandleTop, overlayQrHandleTop, overlayVariantHandleTop } from "./image-overlay-layout"
import { overlayCompositionKey, overlayResultMatches } from "@/lib/image-overlay-platform"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { overlayPlatformById, OVERLAY_MAX_VARIANTS, overlayVariantHandle } from "@nodaro/shared"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import {
  OVERLAY_HANDLE_IDS,
  OVERLAY_MAX_LAYERS,
  DEFAULT_OVERLAY_LAYER,
  visibleOverlayLayerCount,
  type ImageOverlayData,
  type OverlayLayerConfig,
  type GeneratedResult,
} from "@/types/nodes"

const HANDLE_TOP = (i: number) => `${overlayHandleTop(i)}px`
const QR_HANDLE_TOP = (handleCount: number) => `${overlayQrHandleTop(handleCount)}px`
/** A slot shows a wire handle only while it is (or could be) a picture. */
const isImageSlot = (l: OverlayLayerConfig | undefined): boolean => !l || l.kind === undefined || l.kind === "image"
const BASE_TOP = `${OVERLAY_BASE_HANDLE_TOP}px`

function ImageOverlayNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const nodeData = data as ImageOverlayData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const updateNodeInternals = useUpdateNodeInternals()

  const status = nodeData.executionStatus ?? "idle"
  const results: ReadonlyArray<GeneratedResult> = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const layers: ReadonlyArray<OverlayLayerConfig> = Array.isArray(nodeData.layers) ? nodeData.layers : []

  // Base + 2 per extra platform render (shared formula) — not a flat DB price.
  const credits = useEstimatedCredits({ id, type: "image-overlay", data: nodeData } as unknown as WorkflowNode)
  const upstream = useImageOverlayUpstream(id)

  // Handles shown on the node: the configured count, grown to cover any
  // wired or configured layer, capped at the contract maximum.
  const handleCount = visibleOverlayLayerCount(nodeData.layerCount, layers.length, upstream.layers.length)
  // Every dynamic handle set must re-register with React Flow or a new pip is
  // painted but not connectable: layer slots, the QR link handle, and one
  // variant output per ticked platform.
  const variantKey = Array.isArray(nodeData.variants) ? nodeData.variants.join(",") : ""
  const qrLinkKey = layers.some((l) => l?.kind === "qr" && !!l.qr?.fromInput)
  useEffect(() => { updateNodeInternals(id) }, [handleCount, variantKey, qrLinkKey, id, updateNodeInternals])

  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined)
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null)
  // null = automatic: the fresh result when there is one, else the live
  // preview. A result is a snapshot of the composition that produced it —
  // when the composition changes afterwards (layers, platform, canvas, fit)
  // the choice resets to automatic, and a result whose SIZE no longer matches
  // the output (a landscape render under a story canvas — also after a page
  // reload) counts as stale, so the node never shows a picture the settings
  // would not produce.
  const [view, setView] = useState<"preview" | "result" | null>(null)
  const compositionKey = overlayCompositionKey(nodeData)
  const [seenComposition, setSeenComposition] = useState(compositionKey)
  useEffect(() => {
    if (compositionKey === seenComposition) return
    setSeenComposition(compositionKey)
    setView(null)
  }, [compositionKey, seenComposition])
  const [editorOpen, setEditorOpen] = useState(false)
  /** Set by the canvas chip under a QR: open the editor ON that layer's link field. */
  const [editorFocusContent, setEditorFocusContent] = useState(false)
  const upstreamImageAspect = useUpstreamImageAspect(id)

  const handleLoadDimensions = useCallback((dim: { width: number; height: number }) => {
    if (dim.width > 0 && dim.height > 0) setAspectRatio(dim.width / dim.height)
  }, [])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl"))
  }

  const { setLayer, reorder, removeLayer } = useImageOverlayLayers(id, handleCount)
  /** The QR link handle exists only while a QR layer reads its link from the workflow. */
  const qrLinkWired = layers.some((l) => l?.kind === "qr" && !!l.qr?.fromInput)
  /** One source handle per ticked "export also for" platform — wire each to its own publisher. */
  const variantHandles = (Array.isArray(nodeData.variants) ? nodeData.variants : [])
    .map((vid) => overlayPlatformById(vid))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, OVERLAY_MAX_VARIANTS)

  const addLayer = useCallback(() => {
    if (handleCount >= OVERLAY_MAX_LAYERS) return
    updateNodeData(id, { layerCount: handleCount + 1 })
  }, [handleCount, id, updateNodeData])

  const hasResult = status !== "running" && !!activeUrl
  const canBrowseAlternates = !!activeUrl && results.length > 1
  const canPreview = !!upstream.base
  // Results from before the size rode on output_data learn their size the
  // first time they are shown (written back to the stored result).
  const { onLoadDimensions: persistResultDims } = useResultAspectRatio(id, results, activeIndex)
  const resultFresh = overlayResultMatches(nodeData, upstream.baseSize, activeResult as (typeof activeResult & { overlayComposition?: string }) | undefined)
  const effectiveView = view ?? (hasResult && resultFresh ? "result" : "preview")
  const showPreview = status !== "running" && canPreview && (effectiveView === "preview" || !hasResult)

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Layers className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Layers className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        {...imageNodeSizing(
          // In preview the box follows the OUTPUT: a portrait platform makes a portrait node.
          showPreview && nodeData.canvas && nodeData.canvas.width > 0 && nodeData.canvas.height > 0
            ? nodeData.canvas.width / nodeData.canvas.height
            : aspectRatio,
          upstreamImageAspect,
        )}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
        }
        bottomToolbarContent={
          showThumbnails && canBrowseAlternates && !showPreview ? (
            <ResultsThumbnailsPanel
              results={results}
              activeIndex={activeIndex}
              nodeSelected={!!selected || isSettingsOpen}
              mediaType="image"
              onSelect={(i) => updateNodeData(id, { activeResultIndex: i, generatedImageUrl: results[i].url })}
              onDelete={(i) => setDeleteConfirm(i)}
            />
          ) : undefined
        }
        handles={[
          { id: "image", type: "target", position: Position.Left, customStyle: { top: BASE_TOP, left: "-29px" }, external: true },
          ...OVERLAY_HANDLE_IDS.slice(0, handleCount).filter((_, i) => isImageSlot(layers[i])).map((h, i) => ({
            id: h,
            type: "target" as const,
            position: Position.Left,
            customStyle: { top: HANDLE_TOP(OVERLAY_HANDLE_IDS.indexOf(h)), left: "-29px" },
            external: true,
          })),
          ...(qrLinkWired ? [{ id: "qrText", type: "target" as const, position: Position.Left, customStyle: { top: QR_HANDLE_TOP(handleCount), left: "-29px" }, external: true }] : []),
          { id: "image", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "mask", type: "source", position: Position.Right, customStyle: { top: "56px", right: "-29px" }, external: true },
          ...variantHandles.map((p, i) => ({ id: overlayVariantHandle(p.id), type: "source" as const, position: Position.Right, customStyle: { top: `${overlayVariantHandleTop(i)}px`, right: "-29px" }, external: true })),
        ]}
      >
        <div className="relative w-full h-full group/overlay flex flex-col">
          <div className="relative flex-1 min-h-0">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[120px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {status !== "running" && !canPreview && !hasResult && status !== "failed" && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px] px-3 text-center">
                <Layers className="w-10 h-10" />
                <span className="text-[10px] leading-tight">{t("node.connectBaseAndOverlay")}</span>
              </div>
            )}

            {status === "failed" && !hasResult && !canPreview && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 h-[160px] p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{t("node.failed")}</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}

            {showPreview && upstream.base && (
              <ImageOverlayPreview
                baseUrl={upstream.base}
                layerUrls={upstream.layers}
                layers={layers}
                selected={selectedLayer}
                onSelect={setSelectedLayer}
                onLayerChange={setLayer}
                onReorder={reorder}
                onRemove={(i) => { removeLayer(i); setSelectedLayer(null) }}
                onEditContent={(i) => { setSelectedLayer(i); setEditorFocusContent(true); setEditorOpen(true) }}
                qrText={upstream.qrText}
                zones={overlayPlatformById(nodeData.platform)?.zones}
                onBaseDimensions={handleLoadDimensions}
                canvas={nodeData.canvas}
                baseFit={nodeData.baseFit}
                safeArea={overlayPlatformById(nodeData.platform)?.safe}
              />
            )}

            {showPreview && (
              <button
                type="button"
                className="nodrag nopan absolute bottom-2 left-2 z-20 flex items-center gap-1 px-2 py-1 rounded-md bg-black/50 hover:bg-black/70 backdrop-blur-sm border border-white/10 text-white text-[10px] font-medium opacity-0 group-hover/overlay:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setEditorOpen(true) }}
                title={t("overlayEditor.open")}
              >
                <Expand className="w-3 h-3" />
                {t("node.overlayEdit")}
              </button>
            )}

            {showPreview && !hasResult && (
              <div className="pointer-events-none absolute bottom-2 right-2 z-20 max-w-[60%] px-2 py-1 rounded-md bg-black/55 backdrop-blur-sm border border-white/10 text-white/90 text-[10px] leading-snug">
                {t("node.overlayRunHint")}
              </div>
            )}

            {/* Preview ⇄ Result switch, only once both exist. */}
            {status !== "running" && canPreview && hasResult && (
              <div className="nodrag nopan absolute top-2 right-2 z-20 flex rounded-md overflow-hidden border border-white/10 bg-black/50 backdrop-blur-sm text-[10px] font-medium">
                <button type="button" className={`px-2 py-1 ${showPreview ? "bg-[#ff0073] text-white" : "text-white/80 hover:bg-white/10"}`} onClick={(e) => { e.stopPropagation(); setView("preview") }}>
                  {t("node.overlayPreview")}
                </button>
                <button type="button" className={`px-2 py-1 ${!showPreview ? "bg-[#ff0073] text-white" : "text-white/80 hover:bg-white/10"}`} onClick={(e) => { e.stopPropagation(); setView("result") }}>
                  {resultFresh ? t("node.overlayResult") : t("node.overlayResultOld")}
                </button>
              </div>
            )}

            {status !== "running" && hasResult && activeUrl && !showPreview && (
              <>
                {results.length > 1 && (
                  <button
                    type="button"
                    className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 backdrop-blur-sm border rounded-md z-10 transition-opacity ${
                      showThumbnails
                        ? "bg-[#ff0073] hover:bg-[#ff0073]/90 border-[#ff0073] text-white opacity-100"
                        : "bg-black/40 hover:bg-black/60 border-white/10 text-white opacity-0 group-hover/overlay:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowThumbnails((v) => !v)
                    }}
                    title={showThumbnails ? t("node.hideVersions") : t("node.showVersions")}
                    aria-pressed={showThumbnails}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    <span className="text-[11px] font-medium">{results.length}</span>
                  </button>
                )}

                <CachedImage
                  src={activeUrl}
                  alt={t("node.overlayResult")}
                  className="w-full h-full object-contain rounded-xl bg-black/20"
                  thumbnail
                  thumbnailWidth={640}
                  onLoadDimensions={(dim) => { handleLoadDimensions(dim); persistResultDims(dim) }}
                />
                {Array.isArray(nodeData.overlayVariants) && nodeData.overlayVariants.length > 0 && (
                  <div className="nodrag nopan absolute top-2 left-2 right-24 z-10 flex flex-wrap gap-1">
                    {nodeData.overlayVariants.map((v) => (
                      <a
                        key={v.id}
                        href={`/v1/image-proxy?url=${encodeURIComponent(v.url)}&download=1`}
                        download={`${nodeData.label || "overlay"}-${v.id}.${nodeData.outputFormat ?? "png"}`}
                        className="px-1.5 py-0.5 rounded-md bg-black/55 hover:bg-[#ff0073] backdrop-blur-sm border border-white/10 text-white text-[10px]"
                        title={`${v.label} · ${v.width}×${v.height}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {v.label}
                      </a>
                    ))}
                  </div>
                )}

                <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/overlay:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label={t("overlayEditor.open")}
                    className="nodrag nopan h-7 px-2 flex items-center gap-1 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm text-[10px] font-medium"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditorOpen(true)
                    }}
                    title={t("overlayEditor.open")}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {t("node.overlayLayers")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("node.editImage")}
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      openImageEdit(id, activeUrl!, activeResult?.filerobotDesignStateUrl)
                    }}
                    title={t("node.editImage")}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("node.expandPreview")}
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewOpen(true)
                    }}
                    title={t("node.fullscreen")}
                  >
                    <Expand className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("cfgshared.download")}
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      const a = document.createElement("a")
                      a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`
                      a.download = `${nodeData.label || "overlay"}.${nodeData.outputFormat ?? "png"}`
                      a.click()
                    }}
                    title={t("cfgshared.download")}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("cfgshared.copyUrl")}
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(activeUrl!, t("apps.urlCopied"))
                    }}
                    title={t("cfgshared.copyUrl")}
                  >
                    <Link className="w-3.5 h-3.5" />
                  </button>
                  {results.length > 0 && (
                    <button
                      type="button"
                      aria-label={t("node.removeResult")}
                      className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm(activeIndex)
                      }}
                      title={t("node.deleteThisResult")}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="image-overlay" handleId="image" type="target" position={Position.Left} label="Base" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top={BASE_TOP} accepts={(s) => isValidImageOverlayConnection("image", s)} />
      {OVERLAY_HANDLE_IDS.slice(0, handleCount).map((h, i) => isImageSlot(layers[i]) && (
        <HandleWithPopover
          key={h}
          nodeId={id}
          nodeType="image-overlay"
          handleId={h}
          type="target"
          position={Position.Left}
          label={`Layer ${i + 1}`}
          color={HANDLE_COLORS.image}
          icon={<ImageIcon />}
          side="left"
          top={HANDLE_TOP(i)}
          accepts={(s) => isValidImageOverlayConnection(h, s)}
        />
      ))}
      {handleCount < OVERLAY_MAX_LAYERS && (
        <button
          type="button"
          className="nodrag nopan absolute -left-[29px] w-5 h-5 flex items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground/70 hover:text-[#ff0073] hover:border-[#ff0073] bg-background/80"
          style={{ top: `${overlayAddButtonTop(handleCount)}px`, transform: "translateY(2px)" }}
          title={t("node.overlayAddLayer")}
          aria-label={t("node.overlayAddLayer")}
          onClick={(e) => { e.stopPropagation(); addLayer() }}
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
      {qrLinkWired && (
        <HandleWithPopover nodeId={id} nodeType="image-overlay" handleId="qrText" type="target" position={Position.Left} label="QR link" color={HANDLE_COLORS.text} icon={<QrCode />} side="left" top={QR_HANDLE_TOP(handleCount)} accepts={(s) => isValidImageOverlayConnection("qrText", s)} />
      )}
      <HandleWithPopover nodeId={id} nodeType="image-overlay" handleId="image" type="source" position={Position.Right} label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="image-overlay" handleId="mask" type="source" position={Position.Right} label="Mask" color={HANDLE_COLORS.mask} icon={<Layers />} side="right" top="56px" />
      {variantHandles.map((p, i) => (
        <HandleWithPopover key={p.id} nodeId={id} nodeType="image-overlay" handleId={overlayVariantHandle(p.id)} type="source" position={Position.Right} label={localizeOption(p.label)} color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top={`${overlayVariantHandleTop(i)}px`} />
      ))}

      {editorOpen && (
        <ImageOverlayEditor
          nodeId={id}
          open={editorOpen}
          onOpenChange={(o) => { setEditorOpen(o); if (!o) setEditorFocusContent(false) }}
          initialSelected={selectedLayer}
          focusContent={editorFocusContent}
        />
      )}

      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={activeUrl}
          results={results.map((r) => ({ url: r.url }))}
          initialIndex={activeIndex}
        />
      )}
    </div>
  )
}

export const ImageOverlayNode = memo(ImageOverlayNodeComponent)
