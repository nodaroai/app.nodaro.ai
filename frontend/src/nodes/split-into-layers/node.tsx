import { memo, useRef, useState, type CSSProperties } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, Braces, Expand, Image as ImageIcon, Info, Layers, Loader2, RotateCcw, Upload, X } from "lucide-react"
import { BaseNode } from "@/components/nodes/base-node"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { NodeJobProgress } from "@/components/nodes/node-job-progress"
import { RunNodeButton } from "@/components/nodes/run-node-button"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { useUnitUpstreamOutput } from "@/components/nodes/use-unit-upstream-output"
import { imageNodeSizing } from "@/components/nodes/video-node-defaults"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { useUpstreamImageAspect } from "@/hooks/use-upstream-image-aspect"
import { unitInputConnectionAccepted } from "@/lib/ffmpeg-handles"
import { useT } from "@/lib/i18n"
import { unitListNotSavedField, unitPipJson, unitPipList } from "@/lib/unit-compose"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { UnitNodeComponent } from "../kit"
import { useHoldCredits } from "./config"
import { definition } from "./definition.generated"
import type { SplitIntoLayersData, SplitLayer } from "./types"

// The pip glow follows the manifest's declared input — the same rule the canvas
// and the add-node popup judge a wire into it by (unit-connections.ts).
const ACCEPTS_IMAGE = (t: string) => unitInputConnectionAccepted(definition, "image", t)

/** A transparent layer reads as one on a checkerboard; a theme-neutral grey, so both themes keep it. */
const CHECKERBOARD: CSSProperties = {
  background: "repeating-conic-gradient(rgb(128 128 128 / 0.28) 0% 25%, transparent 0% 50%) 50% / 10px 10px",
}

interface ShownLayer {
  readonly url: string
  readonly name: string | undefined
}

/**
 * The layers the node shows: the active take's own when the take carries them,
 * else the node's (unit-compose.ts, `read: "take"` — what a plain wire from
 * the Layers and Layer data pips reads too). After a run once per picture an
 * Each wire, a Bundle and item:N hand on every picture's; the node shows the
 * picture it shows — switching takes shows that picture's layers. Each layer is named from its entry in the layer data, matched by its
 * URL, else by its place in the list.
 */
function shownLayers(data: Readonly<Record<string, unknown>>): ShownLayer[] {
  const urls = unitPipList(definition, data, "layers", "take")?.items ?? []
  const value = unitPipJson(definition, data, "layerData", "take")?.value
  const entries = Array.isArray(value) ? (value as ReadonlyArray<Partial<SplitLayer> | null>) : []
  return urls.map((url, i) => {
    const entry = entries.find((e) => e?.url === url) ?? entries[i]
    const name = typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : undefined
    return { url, name }
  })
}

/**
 * How many layers the run made but could not store (each is retried; one that
 * still fails is dropped and the run completes with the rest): the active
 * take's own count when the take carries one, else the node's. 0 when none.
 */
function layersNotSavedOf(data: Readonly<Record<string, unknown>>): number {
  // `layersNotSaved`: the field every lane lands the Layers pip's count on (unit-compose.ts).
  const field = unitListNotSavedField({ id: "layers" })
  const results = data.generatedResults
  const take: unknown = Array.isArray(results) ? results[(data.activeResultIndex as number | undefined) ?? 0] : undefined
  const v = typeof take === "object" && take !== null && Object.hasOwn(take, field) ? (take as Record<string, unknown>)[field] : data[field]
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

function SplitIntoLayersNode({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SplitIntoLayersData
  // The workflow store's services, bound to this node (the unit kit — a unit never imports the store).
  const kit = useUnitNodeKit(id)
  const { updateNodeData } = kit
  // What a run holds: Max layers plus the base, at its size's tier (price-id.ts).
  const credits = useHoldCredits(nodeData)
  const { upload, isUploading, uploadError } = useFileUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [layerPreview, setLayerPreview] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined
  const { aspectRatio: resultAspect, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const upstreamAspect = useUpstreamImageAspect(id)

  // The picture to split: a wired image wins, else one uploaded on the node.
  const upstreamImageUrl = useUnitUpstreamOutput(id, "image")
  const sourceUrl = upstreamImageUrl ?? nodeData.imageUrl
  const hasResult = !isRunning && !!activeUrl
  const layers = isRunning ? [] : shownLayers(nodeData)
  const notSaved = isRunning ? 0 : layersNotSavedOf(nodeData)
  const layerName = (i: number) => layers[i]?.name ?? t("splitIntoLayers.layerN", { n: i + 1 })

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const res = await upload(file)
      updateNodeData({ imageUrl: res.url })
    } catch {
      // useFileUpload surfaces the error (storage modal / state); nothing else to do.
    }
  }

  function handleDeleteResult(indexToDelete: number) {
    const patch = computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl")
    // The last take gone: its layers (and their count) go with it (a take that remains carries its own).
    const emptied = (patch.generatedResults as readonly unknown[]).length === 0
    updateNodeData(emptied ? { ...patch, generatedLayerUrls: null, generatedLayerData: null, layersNotSaved: null } : patch)
  }

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Layers className="w-3.5 h-3.5" />} onSave={(label) => updateNodeData({ label })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Layers className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={isRunning}
        hideHeader
        {...imageNodeSizing(resultAspect, upstreamAspect)}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={isRunning} onRun={() => kit.run()} />}
        bottomToolbarContent={
          results.length > 1 ? (
            <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
              {results.slice(0, 8).map((r, i) => (
                <button key={`${r.jobId}-${i}`} type="button" aria-label={t("node.switchToResultN", { n: i + 1 })}
                  className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0073]"
                  onClick={(e) => { e.stopPropagation(); updateNodeData({ activeResultIndex: i, generatedImageUrl: r.url }) }}>
                  <CachedImage src={r.url} alt={t("node.resultN", { n: i + 1 })} thumbnail thumbnailWidth={128}
                    className={`w-14 h-14 object-cover rounded-lg ${i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"}`} />
                </button>
              ))}
            </div>
          ) : undefined
        }
        handles={[
          { id: "image", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "base", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "layers", type: "source", position: Position.Right, customStyle: { top: "50%", right: "-29px" }, external: true },
          { id: "layerData", type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
        ]}
      >
        <div className="relative w-full h-full group">
          <input type="file" accept="image/*" className="hidden" ref={fileInputRef}
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = "" }} />

          {/* The base picture */}
          {hasResult && (
            <CachedImage src={activeUrl} alt={nodeData.label} className="w-full h-full object-cover rounded-xl" thumbnail thumbnailWidth={480} onLoadDimensions={onLoadDimensions} />
          )}

          {/* Uploading */}
          {!hasResult && isUploading && (
            <div className="h-full min-h-24 flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t("splitIntoLayers.uploading")}</span>
            </div>
          )}

          {/* Running: the picture being split, faded, with the job's progress */}
          {isRunning && (
            <div className="relative h-full min-h-24 rounded-xl overflow-hidden bg-muted/30">
              {sourceUrl && <img src={sourceUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />}
              <div className="relative h-full flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            </div>
          )}

          {/* Failed */}
          {!isUploading && status === "failed" && !activeUrl && (
            <div className="h-full min-h-24 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-red-500/5 p-3 text-center">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <span className="text-[11px] text-red-400 font-medium">{t("node.failed")}</span>
              {nodeData.errorMessage && <p className="text-[11px] text-muted-foreground line-clamp-2" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>}
              <button type="button" className="nodrag mt-1 h-7 px-3 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 flex items-center gap-1.5"
                onClick={(e) => { e.stopPropagation(); kit.run() }}>
                <RotateCcw className="w-3 h-3" /> {t("editor.retry")}
              </button>
            </div>
          )}

          {/* Idle: the picture to split, or the dropzone */}
          {!isUploading && !isRunning && !activeUrl && status !== "failed" && (
            sourceUrl ? (
              <div className="relative h-full min-h-24 rounded-xl overflow-hidden bg-black">
                <img src={sourceUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
                {!upstreamImageUrl && (
                  <button type="button" aria-label={t("splitIntoLayers.replaceImage")} title={t("splitIntoLayers.replaceImage")}
                    className="absolute right-1.5 top-1.5 w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover/node:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
                    <Upload className="w-3 h-3" />
                  </button>
                )}
              </div>
            ) : (
              <button type="button"
                className={`w-full h-full min-h-24 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors p-2 text-center ${
                  isDragOver ? "border-[#475569] bg-[#475569]/10" : "border-muted-foreground/20 hover:border-[#475569]/50 hover:bg-[#475569]/5"
                }`}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); handleFile(e.dataTransfer.files[0]) }}>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <ImageIcon className="w-4 h-4" />
                  <span className="text-xs">{isDragOver ? t("splitIntoLayers.drop") : t("splitIntoLayers.chooseOrWire")}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">{t("splitIntoLayers.emptyHint")}</span>
              </button>
            )
          )}

          {uploadError && !sourceUrl && (
            <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-red-400 text-[11px]">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span className="truncate">{uploadError}</span>
            </div>
          )}

          {/* On the base: open it full size, or delete this take */}
          {hasResult && (
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" aria-label={t("node.expandPreview")} title={t("node.expandPreview")}
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}>
                <Expand className="w-3.5 h-3.5" />
              </button>
              {results.length > 0 && (
                <button type="button" aria-label={t("node.removeResult")} title={t("node.deleteThisResult")}
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </BaseNode>

      {/* The layers, below the card so the card stays the base picture's size:
          each on a checkerboard (they are transparent), named from the layer data;
          and, when some could not be stored, how many (a notice, not an error). */}
      {(layers.length > 0 || notSaved > 0) && (
        <div data-testid="split-layers-strip" className="absolute left-0 right-0 top-full mt-1 flex flex-col gap-1 nodrag">
          {layers.length > 0 && <span className="text-[11px] text-muted-foreground">{t("splitIntoLayers.layersCount", { n: layers.length })}</span>}
          {notSaved > 0 && (
            <span role="status" className="flex items-center gap-1 text-[11px] text-amber-500">
              <Info className="w-3 h-3 shrink-0" />
              {t("splitIntoLayers.layersNotSaved", { failed: notSaved, total: layers.length + notSaved })}
            </span>
          )}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {layers.map((layer, i) => (
              <button key={`${layer.url}-${i}`} type="button" title={layerName(i)} aria-label={t("splitIntoLayers.openLayer", { name: layerName(i) })}
                className="shrink-0 w-16 flex flex-col gap-0.5 rounded-md border border-border/60 hover:border-primary transition-colors overflow-hidden"
                onClick={(e) => { e.stopPropagation(); setLayerPreview(i) }}>
                <span className="block w-16 h-16" style={CHECKERBOARD}>
                  <CachedImage src={layer.url} alt="" thumbnail thumbnailWidth={128} className="w-16 h-16 object-contain" />
                </span>
                <span className="px-1 pb-0.5 text-[11px] leading-tight truncate text-start">{layerName(i)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <HandleWithPopover nodeId={id} nodeType="split-into-layers" handleId="image" type="target" position={Position.Left} label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_IMAGE} />
      <HandleWithPopover nodeId={id} nodeType="split-into-layers" handleId="base" type="source" position={Position.Right} label="Base" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="split-into-layers" handleId="layers" type="source" position={Position.Right} label={t("splitIntoLayers.pipLayers")} color={HANDLE_COLORS.image} icon={<Layers />} side="right" top="50%" />
      <HandleWithPopover nodeId={id} nodeType="split-into-layers" handleId="layerData" type="source" position={Position.Right} label={t("splitIntoLayers.pipLayerData")} color={HANDLE_COLORS.look} icon={<Braces />} side="right" top="calc(100% - 24px)" />

      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="image" url={activeUrl} results={results} initialIndex={activeIndex} />}
      {layerPreview !== null && layers[layerPreview] && (
        <MediaPreviewModal isOpen onClose={() => setLayerPreview(null)} type="image" url={layers[layerPreview].url}
          results={layers.map((l) => ({ url: l.url, type: "image" as const }))} initialIndex={layerPreview} />
      )}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const NodeComponent: UnitNodeComponent = memo(SplitIntoLayersNode)
