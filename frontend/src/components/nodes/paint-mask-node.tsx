"use client"

import { useT } from "@/lib/i18n"
import { memo, useState, useEffect, lazy, Suspense } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Paintbrush, Layers, Image as ImageIcon, Link2, RotateCcw, Download } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidPaintMaskConnection } from "@/lib/image-producer-handles"
import { BaseNode } from "./base-node"
import { imageNodeSizing } from "./video-node-defaults"
import { useUpstreamImageAspect } from "@/hooks/use-upstream-image-aspect"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { getImageProxyUrl } from "@/lib/api"
import { optimizedImageUrl } from "@/lib/image"
import { EditableNodeLabel } from "./editable-node-label"
import type { PaintMaskData } from "@/types/nodes"

// Lazy-loaded painter — same pattern as reference-board-node.tsx.
const MaskPainterModal = lazy(() =>
  import("@/components/editor/mask-painter-modal").then((m) => ({ default: m.MaskPainterModal })),
)

const PINK = "#ff0073"

/** Upstream image wired into the node's `image` target — the painting
 *  substrate. Falls back to the mask-seed edge's source image (generate-mask's
 *  passthrough pip, or an upstream paint-mask's own substrate) so the common
 *  refine chain `generate-mask.mask → paint-mask` paints without a second
 *  wire. Primitive selector so the node only re-renders on URL change. */
export function usePaintMaskSubstrate(nodeId: string): string | undefined {
  return useWorkflowStore((s) => {
    for (const edge of s.edges) {
      if (edge.target !== nodeId || edge.targetHandle === "mask") continue
      const src = s.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const url = extractNodeOutput(src, edge.sourceHandle ?? undefined)
      if (url) return url
    }
    for (const edge of s.edges) {
      if (edge.target !== nodeId || edge.targetHandle !== "mask") continue
      const src = s.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const url = src.type === "paint-mask"
        ? ((src.data as { sourceImageUrl?: string }).sourceImageUrl)
        : extractNodeOutput(src, "image")
      if (url) return url
    }
    return undefined
  })
}

/** Upstream mask wired into the node's `mask` target — seeds the painter so a
 *  generated mask can be hand-refined (generate-mask.mask → paint-mask). */
export function usePaintMaskSeed(nodeId: string): string | undefined {
  return useWorkflowStore((s) => {
    for (const edge of s.edges) {
      if (edge.target !== nodeId || edge.targetHandle !== "mask") continue
      const src = s.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const url = extractNodeOutput(src, edge.sourceHandle ?? undefined)
      if (url) return url
    }
    return undefined
  })
}

/** Sampled white-coverage % of a mask PNG, and its pixel dimensions. */
function useMaskStats(maskUrl: string | undefined): { coverage: number | null; dims: string | null } {
  const [stats, setStats] = useState<{ coverage: number | null; dims: string | null }>({ coverage: null, dims: null })
  useEffect(() => {
    if (!maskUrl) {
      setStats({ coverage: null, dims: null })
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      if (cancelled) return
      const w = img.naturalWidth
      const h = img.naturalHeight
      try {
        const c = document.createElement("canvas")
        c.width = w
        c.height = h
        const ctx = c.getContext("2d")!
        ctx.drawImage(img, 0, 0)
        const step = 12
        const d = ctx.getImageData(0, 0, w, h).data
        let on = 0
        let total = 0
        for (let y = 0; y < h; y += step) {
          for (let x = 0; x < w; x += step) {
            total++
            if (d[(y * w + x) * 4]! > 127) on++
          }
        }
        setStats({ coverage: total ? Math.round((on / total) * 100) : 0, dims: `${w} × ${h}` })
      } catch {
        setStats({ coverage: null, dims: `${w} × ${h}` })
      }
    }
    img.onerror = () => { if (!cancelled) setStats({ coverage: null, dims: null }) }
    img.src = getImageProxyUrl(maskUrl)
    return () => { cancelled = true }
  }, [maskUrl])
  return stats
}

function timeAgo(epochMs: number | undefined): string | null {
  if (!epochMs) return null
  const s = Math.max(0, Math.floor((Date.now() - epochMs) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `edited ${Math.floor(s / 60)}m ago`
  if (s < 86400) return `edited ${Math.floor(s / 3600)}h ago`
  return `edited ${Math.floor(s / 86400)}d ago`
}

const ACCEPTS_IMAGE = (t: string) => isValidPaintMaskConnection("image", t)
const ACCEPTS_MASK = (t: string) => isValidPaintMaskConnection("mask", t)

function PaintMaskNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as PaintMaskData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const upstreamImageUrl = usePaintMaskSubstrate(id)
  const seedMaskUrl = usePaintMaskSeed(id)
  const substrateUrl = upstreamImageUrl ?? nodeData.sourceImageUrl

  const [painterOpen, setPainterOpen] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined)
  const upstreamImageAspect = useUpstreamImageAspect(id)

  const maskUrl = nodeData.maskUrl
  const { coverage, dims } = useMaskStats(maskUrl)
  const edited = timeAgo(nodeData.maskUpdatedAt)

  const openPainter = () => { if (substrateUrl) setPainterOpen(true) }

  function handleSaved(url: string) {
    updateNodeData(id, { maskUrl: url, sourceImageUrl: substrateUrl, maskUpdatedAt: Date.now() })
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation()
    if (!maskUrl) return
    const a = document.createElement("a")
    a.href = `/v1/image-proxy?url=${encodeURIComponent(maskUrl)}&download=1`
    a.download = `${nodeData.label || "mask"}.png`
    a.click()
  }

  const hasMask = !!maskUrl
  const state: 1 | 2 | 3 = !substrateUrl && !hasMask ? 1 : !hasMask ? 2 : 3

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Paintbrush className="w-3.5 h-3.5" style={hasMask ? { color: PINK } : undefined} />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Paintbrush className="h-4 w-4" />}
        category="processing"
        selected={selected}
        {...imageNodeSizing(aspectRatio, upstreamImageAspect)}
        hideHeader
        handles={[
          { id: "image", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "mask",  type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
          { id: "mask",  type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        <div className="relative w-full h-full group/paintmask flex flex-col rounded-2xl border border-border bg-card dark:border-[#232327] dark:bg-[#111114] overflow-hidden">
          {/* Media area */}
          <div className="relative flex-1 min-h-0 m-3 rounded-[10px] overflow-hidden bg-muted/40 dark:bg-[#0e0e10]">

            {state === 1 && (
              <div className="w-full h-full min-h-[160px] rounded-[10px] border border-dashed border-border dark:border-[#2e2e34] flex flex-col items-center justify-center gap-2.5 text-center px-3">
                <div className="w-[34px] h-[34px] rounded-[9px] border border-border dark:border-[#2e2e34] flex items-center justify-center text-muted-foreground/60 dark:text-[#4f4f57]">
                  <Link2 className="w-4 h-4" />
                </div>
                <div className="text-muted-foreground dark:text-[#75757c] text-xs">{t("node.connectAnImageToPaint")}</div>
                <div className="text-muted-foreground/60 dark:text-[#4f4f57] text-[10.5px] font-mono">wire the image input</div>
              </div>
            )}

            {/* Everything below sits ON the image under a dark scrim
                (rgba(10,10,12,…) gradients), so its light text / dark chrome is
                image-relative and correct in BOTH themes — deliberately fixed. */}
            {state === 2 && substrateUrl && (
              <button
                type="button"
                className="nodrag relative w-full h-full min-h-[200px] block text-left cursor-pointer"
                onClick={(e) => { e.stopPropagation(); openPainter() }}
                onDoubleClick={openPainter}
                title={t("node.paintMask")}
              >
                <img
                  src={optimizedImageUrl(substrateUrl)}
                  alt="Source"
                  className="w-full h-full object-cover opacity-55"
                  draggable={false}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                  style={{ background: "linear-gradient(180deg, rgba(10,10,12,.35), rgba(10,10,12,.8))" }}>
                  <div className="text-[#e6e6ea] text-xs">{t("node.noMaskPaintedYet")}</div>
                  <span
                    className="flex items-center gap-2 h-9 px-4 rounded-[10px] text-white text-[12.5px] font-medium"
                    style={{ background: PINK, boxShadow: "0 6px 20px rgba(255,0,115,.35)" }}
                  >
                    <Paintbrush className="w-3.5 h-3.5" /> {t("node.paintMask")}
                  </span>
                </div>
              </button>
            )}

            {state === 3 && (
              <div className="nodrag relative w-full h-full min-h-[200px]" onDoubleClick={openPainter}>
                {substrateUrl ? (
                  <img
                    src={optimizedImageUrl(substrateUrl)}
                    alt="Source"
                    className="w-full h-full object-cover"
                    draggable={false}
                    onLoad={(e) => {
                      const t = e.currentTarget
                      if (t.naturalWidth > 0 && t.naturalHeight > 0) setAspectRatio(t.naturalWidth / t.naturalHeight)
                    }}
                  />
                ) : (
                  <img
                    src={optimizedImageUrl(maskUrl!)}
                    alt="Mask"
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                )}
                {/* Painted region tinted brand-pink via luminance mask */}
                {substrateUrl && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: "rgba(255,0,115,.42)",
                      maskImage: `url(${getImageProxyUrl(maskUrl!)})`,
                      maskSize: "100% 100%",
                      maskMode: "luminance",
                    }}
                  />
                )}
                {coverage != null && (
                  <div className="absolute left-2 top-2 px-2 py-[3px] rounded-full text-[10px] font-mono text-[#e6e6ea] border border-[#2c2c32]"
                    style={{ background: "rgba(10,10,12,.72)" }}>
                    {coverage}% masked
                  </div>
                )}
                {/* Hover actions */}
                <div className="absolute inset-0 flex items-end justify-center p-3 opacity-0 group-hover/paintmask:opacity-100 transition-opacity"
                  style={{ background: "linear-gradient(180deg, transparent 55%, rgba(10,10,12,.85))" }}>
                  <div className="flex gap-2 w-full">
                    <button
                      type="button"
                      className="nodrag flex-1 h-[34px] rounded-[9px] text-white text-xs font-medium disabled:opacity-50"
                      style={{ background: PINK }}
                      onClick={(e) => { e.stopPropagation(); openPainter() }}
                      disabled={!substrateUrl}
                      title={substrateUrl ? t("node.editMask") : t("imgcfg.connectImageFirst")}
                    >
                      {t("node.editMask")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("node.clearMask")}
                      className="w-[34px] h-[34px] rounded-[9px] border border-[#34343b] text-[#c9c9d0] hover:bg-[#26262b] flex items-center justify-center"
                      style={{ background: "rgba(20,20,24,.9)" }}
                      onClick={(e) => { e.stopPropagation(); updateNodeData(id, { maskUrl: undefined, maskUpdatedAt: undefined }) }}
                      title={t("node.clearMask")}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("node.downloadMask")}
                      className="w-[34px] h-[34px] rounded-[9px] border border-[#34343b] text-[#c9c9d0] hover:bg-[#26262b] flex items-center justify-center"
                      style={{ background: "rgba(20,20,24,.9)" }}
                      onClick={handleDownload}
                      title={t("node.downloadMask")}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer strip */}
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-t border-border dark:border-[#1d1d21]">
            {state === 1 && (
              <>
                <span className="text-muted-foreground/60 dark:text-[#4f4f57] text-[11px]">{t("node.waitingForInput")}</span>
                <span className="px-2 py-0.5 rounded-full bg-muted dark:bg-[#1a1a1e] text-muted-foreground/70 dark:text-[#5c5c64] text-[10px] font-mono">idle</span>
              </>
            )}
            {state === 2 && (
              <>
                <span className="text-muted-foreground dark:text-[#75757c] text-[11px] font-mono">{dims ?? "ready to paint"}</span>
                <span className="text-muted-foreground/60 dark:text-[#4f4f57] text-[10.5px]">double-click to open</span>
              </>
            )}
            {state === 3 && (
              <>
                <span className="flex items-center gap-1.5 text-foreground/70 dark:text-[#a1a1a8] text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: PINK }} />
                  {t("node.maskReady")}
                </span>
                <span className="text-muted-foreground/60 dark:text-[#4f4f57] text-[10.5px] font-mono">{edited ?? dims ?? ""}</span>
              </>
            )}
          </div>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="paint-mask" handleId="image" type="target" position={Position.Left}  label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_IMAGE} />
      <HandleWithPopover nodeId={id} nodeType="paint-mask" handleId="mask"  type="target" position={Position.Left}  label={t("node.maskSeed")} color={HANDLE_COLORS.mask} icon={<Layers />} side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_MASK} />
      <HandleWithPopover nodeId={id} nodeType="paint-mask" handleId="mask"  type="source" position={Position.Right} label="Mask"  color={HANDLE_COLORS.mask} icon={<Layers />}    side="right" top="24px" />

      {painterOpen && substrateUrl && (
        <Suspense fallback={null}>
          <MaskPainterModal
            isOpen={painterOpen}
            onClose={() => setPainterOpen(false)}
            imageUrl={substrateUrl}
            initialMaskUrl={maskUrl ?? seedMaskUrl}
            onSave={handleSaved}
            initialBrushSize={nodeData.defaultBrushSize}
            initialBrushHardness={nodeData.defaultBrushHardness}
          />
        </Suspense>
      )}
    </div>
  )
}

export const PaintMaskNode = memo(PaintMaskNodeComponent)
