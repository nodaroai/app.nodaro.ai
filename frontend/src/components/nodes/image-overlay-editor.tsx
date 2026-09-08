"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Image as ImageIcon, Link2, Loader2, Lock, MonitorSmartphone, QrCode, Square, Trash2, Type, Upload } from "lucide-react"
import { useT } from "@/lib/i18n"
import { isEditableTarget } from "@/lib/dom-editable"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { overlayPlatformPatch } from "@/lib/image-overlay-platform"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useImageOverlayUpstream } from "@/hooks/use-image-overlay-upstream"
import { useImageOverlayAddLayer } from "@/hooks/use-image-overlay-add-layer"
import { useImageOverlayLayers } from "@/hooks/use-image-overlay-layers"
import { ImageOverlayPreview } from "./image-overlay-preview"
import { QrLayerPreview, ShapeGlyph } from "./image-overlay-kinds"
import { OverlayLayerEditor } from "@/components/editor/config-panels/image-overlay-layer-editor"
import { overlayRenderOrder } from "@/lib/image-overlay-geometry"
import { qrLinkLabel, textLayerLabel } from "@/lib/image-overlay-labels"
import { overlayFontFamily } from "@/lib/overlay-fonts"
import { DEFAULT_OVERLAY_QR, OVERLAY_PLATFORMS, overlayPlatformById, type OverlayLayerKind } from "@nodaro/shared"
import {
  DEFAULT_OVERLAY_LAYER,
  OVERLAY_HANDLE_IDS,
  OVERLAY_MAX_LAYERS,
  visibleOverlayLayerCount,
  type ImageOverlayData,
  type OverlayLayerConfig,
} from "@/types/nodes"

/** The platforms most people reach for, as one-click chips beside the full picker. */
const QUICK_PLATFORMS: ReadonlyArray<{ id: string; key: "story" | "post" | "youtube" | "linkedin" }> = [
  { id: "instagram-story", key: "story" },
  { id: "instagram-post", key: "post" },
  { id: "youtube-thumbnail", key: "youtube" },
  { id: "linkedin-company", key: "linkedin" },
]

/** Mirrors the server's upload allow-list (utils/file-validation.ts) — SVG is not accepted as an upload today. */
const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp"

/** Focus a layer's main content field once the right panel has rendered it. */
function focusLayerField(index: number) {
  window.setTimeout(() => {
    const el = document.getElementById(`ov-${index}-qr`) ?? document.getElementById(`ov-${index}-text`)
    if (el instanceof HTMLElement) {
      el.focus()
      if (el instanceof HTMLInputElement) el.select()
    }
  }, 0)
}

/**
 * The full-screen compositor: the same live preview the node shows, at
 * canvas size, with a layer list on the left ("Add a layer" cards + the
 * stack) and the selected layer's settings on the right. Everything writes
 * straight into the node's data — closing the editor loses nothing and the
 * run uses exactly these numbers. Mount it only while open (it subscribes to
 * the store for the node, its wires and the auth user).
 */
export function ImageOverlayEditor({ nodeId, open, onOpenChange, initialSelected, focusContent }: {
  nodeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The layer to open on (the caller's selection); defaults to the first. */
  initialSelected?: number | null
  /** Jump straight to that layer's content field (the canvas "edit" chip). */
  focusContent?: boolean
}) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const nodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.data as ImageOverlayData | undefined)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const upstream = useImageOverlayUpstream(nodeId)
  const [selected, setSelected] = useState<number | null>(initialSelected === undefined ? 0 : initialSelected)
  useEffect(() => {
    if (open && focusContent && initialSelected !== null && initialSelected !== undefined) focusLayerField(initialSelected)
    // Only on open: the caller's intent, not every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { addFromFile, isUploading } = useImageOverlayAddLayer(nodeId)

  const layers: ReadonlyArray<OverlayLayerConfig> = Array.isArray(nodeData?.layers) ? nodeData!.layers : []
  const handleCount = visibleOverlayLayerCount(nodeData?.layerCount, layers.length, upstream.layers.length)
  const { setLayer, reorder, addGenerated, removeLayer } = useImageOverlayLayers(nodeId, handleCount)
  const wiredSlots = OVERLAY_HANDLE_IDS.map((_, i) => !!upstream.layers[i])
  const filled = Array.from({ length: handleCount }, (_, k) => layers[k] ?? DEFAULT_OVERLAY_LAYER)
  const order = overlayRenderOrder(filled)
  const wiredCount = upstream.layers.filter(Boolean).length
  const slotsLeft = wiredCount < OVERLAY_MAX_LAYERS

  const hasContent = (i: number) => (filled[i]?.kind ?? "image") !== "image" || !!upstream.layers[i]
  const deleteLayer = (i: number) => {
    removeLayer(i)
    setSelected(null)
  }
  const add = (kind: Exclude<OverlayLayerKind, "image">) => {
    const s = addGenerated(kind, wiredSlots)
    if (s !== null) {
      setSelected(s)
      focusLayerField(s)
    }
    return s
  }
  const editContent = (i: number) => {
    setSelected(i)
    focusLayerField(i)
  }

  if (!nodeData) return null
  const platform = overlayPlatformById(nodeData.platform)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton
        onKeyDown={(e) => {
          if (e.key !== "Delete" && e.key !== "Backspace") return
          if (isEditableTarget(e.target)) return
          // Delete means the LAYER here. Stop the key before the canvas sees it
          // and deletes the (still selected) node under the dialog.
          e.preventDefault()
          e.stopPropagation()
          if (selected !== null && hasContent(selected)) deleteLayer(selected)
        }}
      >
        <div className="flex items-center gap-3 px-4 h-12 border-b border-border/60 shrink-0">
          <DialogTitle className="text-sm font-semibold">{t("overlayEditor.title")}</DialogTitle>
          <span className="text-xs text-muted-foreground">{nodeData.label}</span>
          {/* Platform: the output's size and the device viewports drawn on the
              stage. Styled as the header's one obvious control — a pink pill
              with the brand icon — plus one-click chips for the usual targets,
              so nobody has to guess that the output size is a choice. */}
          <div className="ms-5 flex items-center gap-1.5">
            <Select
              value={platform ? platform.id : "none"}
              onValueChange={(id) => updateNodeData(nodeId, overlayPlatformPatch(id, nodeData))}
            >
              <SelectTrigger
                className={`h-8 rounded-full border-2 ps-2.5 pe-3 gap-2 text-xs font-medium shadow-sm transition-colors ${platform ? "border-[#ff0073] bg-[#ff0073] text-white hover:bg-[#ff0073]/90" : "border-[#ff0073] bg-[#ff0073]/10 text-[#ff0073] hover:bg-[#ff0073]/20"}`}
                aria-label={t("overlayPlatform.label")}
              >
                <MonitorSmartphone className="w-4 h-4 shrink-0" aria-hidden />
                <span className="shrink-0">{t("overlayEditor.platform")}:</span>
                <span className="truncate max-w-[16rem]">{platform ? `${localizeOption(platform.label)} · ${platform.width}×${platform.height}` : t("overlayEditor.choosePlatform")}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("overlayPlatform.none")}</SelectItem>
                {OVERLAY_PLATFORMS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{localizeOption(p.label)} · {p.width}×{p.height}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="hidden lg:flex items-center gap-1 ms-1" role="group" aria-label={t("overlayEditor.quickPlatforms")}>
              {QUICK_PLATFORMS.map((q) => {
                const on = platform?.id === q.id
                return (
                  <button
                    key={q.id}
                    type="button"
                    aria-pressed={on}
                    className={`h-7 rounded-full border px-2.5 text-[11px] transition-colors ${on ? "border-[#ff0073] bg-[#ff0073]/15 text-[#ff0073] font-medium" : "border-border/70 text-muted-foreground hover:border-[#ff0073]/60 hover:text-foreground"}`}
                    onClick={() => updateNodeData(nodeId, overlayPlatformPatch(on ? "none" : q.id, nodeData))}
                  >
                    {t(`overlayEditor.quick.${q.key}` as never)}
                  </button>
                )
              })}
            </div>
            {platform?.note && <span className="hidden 2xl:inline text-[10px] text-muted-foreground max-w-[22rem] truncate ms-1" title={localizeOption(platform.note)}>{localizeOption(platform.note)}</span>}
          </div>
          <span className="text-[11px] text-muted-foreground ms-auto me-10">
            {platform
              ? `${t("proccfg.overlay.outputSize")}: ${platform.width} × ${platform.height}`
              : upstream.baseSize ? t("proccfg.overlay.baseSize", { w: upstream.baseSize.w, h: upstream.baseSize.h }) : ""}
          </span>
        </div>

        <div className="flex flex-1 min-h-0">
          <aside className="w-64 shrink-0 border-e border-border/60 overflow-y-auto p-2 space-y-3">
            {/* Add a layer — four equal choices, each says what it makes. */}
            <div>
              <div className="text-[11px] font-medium text-muted-foreground px-1 py-1">{t("overlayEditor.addSection")}</div>
              <input
                ref={fileInputRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) void addFromFile(file)
                }}
              />
              <div className="space-y-1">
                <AddCard icon={isUploading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Upload className="w-4 h-4" aria-hidden />} title={t("overlayEditor.uploadLayer")} desc={t("overlayEditor.addUploadDesc")} disabled={isUploading || !slotsLeft} onClick={() => fileInputRef.current?.click()} />
                <QrAddCard disabled={!slotsLeft} onAdd={(text) => { const s = add("qr"); if (s !== null) setLayer(s, { qr: { ...DEFAULT_OVERLAY_QR, text } }) }} />
                <AddCard icon={<Type className="w-4 h-4" aria-hidden />} title={t("overlayEditor.addTextTitle")} desc={t("overlayEditor.addTextDesc")} disabled={!slotsLeft} onClick={() => add("text")} />
                <AddCard icon={<Square className="w-4 h-4" aria-hidden />} title={t("overlayEditor.addShapeTitle")} desc={t("overlayEditor.addShapeDesc")} disabled={!slotsLeft} onClick={() => add("shape")} />
              </div>
            </div>

            {/* Layer list — top row is the top of the stack. */}
            <div>
              <div id="overlay-layer-list-label" className="flex items-center px-1 py-1 text-[11px] font-medium text-muted-foreground">
                <span>{t("overlayEditor.layers")}</span>
                <span className="ms-auto rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{filled.filter((_, i) => hasContent(i)).length}</span>
              </div>
              <ul aria-labelledby="overlay-layer-list-label" className="space-y-0.5">
                {[...order].reverse().map((i) => (
                  <LayerRow
                    key={i}
                    index={i}
                    layer={filled[i] ?? DEFAULT_OVERLAY_LAYER}
                    url={upstream.layers[i]}
                    qrText={upstream.qrText}
                    selected={selected === i}
                    onSelect={() => setSelected(i)}
                    onReorder={(d) => reorder(i, d)}
                    onDelete={hasContent(i) ? () => deleteLayer(i) : undefined}
                  />
                ))}
                <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground rounded-md" aria-disabled>
                  <span className="w-9 h-7 rounded bg-muted/60 flex items-center justify-center shrink-0"><ImageIcon className="w-3.5 h-3.5" aria-hidden /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[9px] font-semibold uppercase tracking-wide">{t("overlayEditor.tag.base")}</span>
                    <span className="block truncate">{upstream.baseSize ? `${upstream.baseSize.w} × ${upstream.baseSize.h}` : t("overlayEditor.background")}</span>
                  </span>
                  <Lock className="w-3 h-3 opacity-60" aria-hidden />
                </li>
              </ul>
              {handleCount < OVERLAY_MAX_LAYERS && (
                <button
                  type="button"
                  className="mt-1 w-full py-1 text-[11px] text-muted-foreground hover:text-[#ff0073] text-start px-2"
                  onClick={() => updateNodeData(nodeId, { layerCount: handleCount + 1 })}
                >
                  {t("overlayEditor.addLayer")}
                </button>
              )}
            </div>
          </aside>

          {/* Stage */}
          <main className="flex-1 min-w-0 bg-black/40 p-4">
            {upstream.base ? (
              <ImageOverlayPreview
                baseUrl={upstream.base}
                layerUrls={upstream.layers}
                layers={layers}
                selected={selected}
                onSelect={setSelected}
                onLayerChange={setLayer}
                onReorder={reorder}
                onRemove={deleteLayer}
                onEditContent={editContent}
                qrText={upstream.qrText}
                canvas={nodeData.canvas}
                baseFit={nodeData.baseFit}
                safeArea={platform?.safe}
                zones={platform?.zones}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">{t("node.connectBaseAndOverlay")}</div>
            )}
          </main>

          {/* Selected layer */}
          <aside className="w-80 shrink-0 border-s border-border/60 overflow-y-auto p-3">
            {selected !== null ? (
              <OverlayLayerEditor
                index={selected}
                layer={filled[selected] ?? DEFAULT_OVERLAY_LAYER}
                connected={(filled[selected]?.kind ?? "image") !== "image" || !!upstream.layers[selected]}
                base={upstream.baseSize}
                onChange={(patch) => setLayer(selected, patch)}
                baseUrl={upstream.base}
                safeArea={overlayPlatformById(nodeData.platform)?.safe}
                wiredQrText={upstream.qrText}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t("overlayEditor.selectHint")}</p>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddCard({ icon, title, desc, disabled, onClick }: { icon: React.ReactNode; title: string; desc: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="w-full flex items-center gap-2.5 rounded-md border border-border/70 px-2 py-1.5 text-start hover:border-[#ff0073] hover:bg-[#ff0073]/5 disabled:opacity-50 disabled:hover:border-border/70 disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <span className="w-7 h-7 rounded-md bg-muted/70 flex items-center justify-center shrink-0 text-foreground/80">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium">{title}</span>
        <span className="block text-[10px] text-muted-foreground truncate">{desc}</span>
      </span>
    </button>
  )
}

/**
 * QR is link-first: the card opens a small form that asks for the URL (with
 * a live code) BEFORE the layer exists, so nobody misses that a QR carries
 * an editable link — they typed it themselves.
 */
function QrAddCard({ disabled, onAdd }: { disabled?: boolean; onAdd: (text: string) => void }) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (draft !== null) inputRef.current?.focus() }, [draft])
  if (draft === null) {
    return <AddCard icon={<QrCode className="w-4 h-4" aria-hidden />} title={t("overlayEditor.addQrTitle")} desc={t("overlayEditor.addQrDesc")} disabled={disabled} onClick={() => setDraft("https://")} />
  }
  const text = draft.trim()
  const ready = text.length > 0 && text !== "https://"
  const submit = () => {
    if (!ready) return
    onAdd(text)
    setDraft(null)
  }
  return (
    <div className="rounded-md border border-[#ff0073]/60 bg-[#ff0073]/5 p-2 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium"><QrCode className="w-3.5 h-3.5" aria-hidden />{t("overlayEditor.qrNewTitle")}</div>
      <p className="text-[10px] text-muted-foreground">{t("overlayEditor.qrNewHint")}</p>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="relative">
            <Link2 className="w-3.5 h-3.5 absolute start-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={inputRef}
              value={draft}
              maxLength={2000}
              className="ps-7 h-8 text-xs"
              placeholder="https://"
              aria-label={t("overlayKinds.qrLinkTitle")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit() } if (e.key === "Escape") { e.preventDefault(); setDraft(null) } }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground truncate">{qrLinkLabel(draft) || " "}</div>
        </div>
        <div className="w-14 h-14 shrink-0 rounded bg-white p-0.5"><QrLayerPreview style={{ ...DEFAULT_OVERLAY_QR, text: text || " " }} /></div>
      </div>
      <div className="flex gap-1.5">
        <button type="button" className="flex-1 h-7 rounded-md bg-[#ff0073] text-white text-xs font-medium hover:bg-[#ff0073]/90 disabled:opacity-50" disabled={!ready} onClick={submit}>{t("overlayEditor.qrAdd")}</button>
        <button type="button" className="h-7 px-2 rounded-md border border-border/70 text-xs hover:bg-muted" onClick={() => setDraft(null)}>{t("common.cancel")}</button>
      </div>
    </div>
  )
}

/** One row of the stack: thumbnail, type tag, what it carries, reorder + delete. */
function LayerRow({ index, layer, url, qrText, selected, onSelect, onReorder, onDelete }: {
  index: number
  layer: OverlayLayerConfig
  url: string | undefined
  qrText: string | undefined
  selected: boolean
  onSelect: () => void
  onReorder: (direction: "up" | "down") => void
  onDelete?: () => void
}) {
  const t = useT()
  const kind = layer.kind ?? "image"
  const wired = kind !== "image" || !!url
  const handle = OVERLAY_HANDLE_IDS[index]
  const tag = kind === "image" ? (url ? t("overlayEditor.tag.image") : `${t("overlayEditor.tag.slot")} · ${handle}`) : t(`overlayEditor.tag.${kind}` as never)
  const content =
    kind === "text" ? textLayerLabel(layer.text?.text) || t("overlayEditor.layerN", { n: index + 1 })
    : kind === "qr" ? (layer.qr?.fromInput ? (qrLinkLabel(qrText) || t("overlayEditor.fromWorkflow")) : qrLinkLabel(layer.qr?.text) || t("overlayEditor.layerN", { n: index + 1 }))
    : kind === "shape" ? t(`overlayKinds.shape.${layer.shape?.shape ?? "rect"}` as never)
    : url ? t("overlayEditor.layerN", { n: index + 1 }) : t("overlayEditor.empty")
  return (
    <li
      aria-current={selected ? "true" : undefined}
      className={`flex items-center gap-1 rounded-md text-xs ${selected ? "bg-[#ff0073]/15 text-foreground" : "hover:bg-muted/60 text-foreground/80"} ${wired ? "" : "opacity-60"}`}
    >
      <button type="button" aria-pressed={selected} className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-start" onClick={onSelect}>
        <span className="w-9 h-7 rounded bg-muted/60 overflow-hidden flex items-center justify-center shrink-0 text-foreground/70">
          {kind === "image" && url && <img src={url} alt="" draggable={false} className="w-full h-full object-contain" />}
          {kind === "image" && !url && <ImageIcon className="w-3.5 h-3.5" aria-hidden />}
          {kind === "qr" && <span className="w-6 h-6 bg-white p-px"><QrLayerPreview style={{ ...DEFAULT_OVERLAY_QR, ...(layer.qr ?? {}), text: (layer.qr?.fromInput ? qrText : layer.qr?.text) || " " }} /></span>}
          {kind === "text" && <span className="text-sm font-bold leading-none" style={{ fontFamily: overlayFontFamily(layer.text?.fontId ?? "inter") }}>T</span>}
          {kind === "shape" && <ShapeGlyph shape={layer.shape?.shape ?? "rect"} className="w-7 h-4" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{tag}</span>
          <span className="block truncate" title={content}>{content}</span>
          {kind === "qr" && <span className="block text-[9px] text-[#ff0073]">{layer.qr?.fromInput ? t("overlayEditor.linkFromWorkflow") : t("overlayEditor.editableLink")}</span>}
        </span>
      </button>
      <span className="flex flex-col">
        <button type="button" className="h-3.5 hover:text-[#ff0073]" aria-label={t("overlayEditor.bringForward")} title={t("overlayEditor.bringForward")} onClick={() => onReorder("up")}>
          <ChevronUp className="w-3 h-3" aria-hidden />
        </button>
        <button type="button" className="h-3.5 hover:text-[#ff0073]" aria-label={t("overlayEditor.sendBackward")} title={t("overlayEditor.sendBackward")} onClick={() => onReorder("down")}>
          <ChevronDown className="w-3 h-3" aria-hidden />
        </button>
      </span>
      {onDelete ? (
        <button type="button" className="h-6 w-6 me-0.5 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10" aria-label={t("overlayEditor.deleteLayer")} title={t("overlayEditor.deleteLayerHint")} onClick={onDelete}>
          <Trash2 className="w-3 h-3" aria-hidden />
        </button>
      ) : (
        <span className="w-6 me-0.5" aria-hidden />
      )}
    </li>
  )
}
