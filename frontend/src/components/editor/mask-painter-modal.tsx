"use client"

import { useEffect, useCallback, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { Paintbrush, Eraser, Triangle, Undo2, Redo2, X, Loader2 } from "lucide-react"
import { uploadImage, getImageProxyUrl } from "@/lib/api"
import { useBackToClose } from "@/hooks/use-back-to-close"
import { useT, type MessageKey } from "@/lib/i18n"

type Tool = "brush" | "eraser" | "lasso"
type ViewMode = "overlay" | "mask" | "source"

const PINK = "#ff0073"
const UNDO_CAP = 20
const VIEW_MODE_KEYS: Record<ViewMode, MessageKey> = {
  overlay: "mediaed.viewOverlay",
  mask: "mediaed.viewMask",
  source: "mediaed.viewSource",
}

interface MaskPainterModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly imageUrl: string
  readonly initialMaskUrl?: string
  readonly onSave: (maskUrl: string) => void
  /** Painter defaults (node settings). */
  readonly initialBrushSize?: number
  readonly initialBrushHardness?: number
}

/** Basename of a URL for the header subtitle — decoded, query stripped. */
function urlBasename(url: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname
    return decodeURIComponent(path.split("/").pop() || "image")
  } catch {
    return "image"
  }
}

export function MaskPainterModal({
  isOpen, onClose, imageUrl, initialMaskUrl, onSave,
  initialBrushSize, initialBrushHardness,
}: MaskPainterModalProps) {
  const tr = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  // Offscreen truth: the mask itself, at full source resolution (black=keep, white=edit).
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const tmpCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const undoStackRef = useRef<HTMLCanvasElement[]>([])
  const redoStackRef = useRef<HTMLCanvasElement[]>([])
  const drawingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)
  const dirtyRef = useRef(false)

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [tool, setTool] = useState<Tool>("brush")
  const [viewMode, setViewMode] = useState<ViewMode>("overlay")
  const [brushSize, setBrushSize] = useState(initialBrushSize ?? 48)
  const [hardness, setHardness] = useState(initialBrushHardness ?? 70)
  const [flow, setFlow] = useState(100)
  const [zoom, setZoom] = useState(100)
  const [fitScale, setFitScale] = useState(1)
  const [coverage, setCoverage] = useState(0)
  const [lassoPoints, setLassoPoints] = useState<Array<{ x: number; y: number }>>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [saving, setSaving] = useState(false)

  useBackToClose(isOpen, onClose)

  // ── Mask ops ─────────────────────────────────────────────────────────

  const maskCtx = () => maskCanvasRef.current?.getContext("2d") ?? null

  const measureCoverage = useCallback(() => {
    const mask = maskCanvasRef.current
    const ctx = maskCtx()
    if (!mask || !ctx) return
    const step = 12
    const d = ctx.getImageData(0, 0, mask.width, mask.height).data
    let on = 0
    let total = 0
    for (let y = 0; y < mask.height; y += step) {
      for (let x = 0; x < mask.width; x += step) {
        total++
        if (d[(y * mask.width + x) * 4]! > 127) on++
      }
    }
    setCoverage(total ? Math.round((on / total) * 100) : 0)
  }, [])

  const compose = useCallback(() => {
    const cv = canvasRef.current
    const mask = maskCanvasRef.current
    const tmp = tmpCanvasRef.current
    const img = imgRef.current
    if (!cv || !mask || !tmp) return
    const ctx = cv.getContext("2d")
    if (!ctx) return
    const { width: W, height: H } = mask
    ctx.clearRect(0, 0, W, H)

    if (viewMode === "mask") {
      ctx.drawImage(mask, 0, 0)
    } else if (img) {
      ctx.drawImage(img, 0, 0, W, H)
      if (viewMode === "overlay") {
        // Tint the mask's white region brand-pink and lay it over the source.
        const t = tmp.getContext("2d")!
        t.globalCompositeOperation = "source-over"
        t.clearRect(0, 0, W, H)
        t.drawImage(mask, 0, 0)
        t.globalCompositeOperation = "multiply"
        t.fillStyle = PINK
        t.fillRect(0, 0, W, H)
        t.globalCompositeOperation = "destination-in"
        t.drawImage(mask, 0, 0)
        ctx.save()
        ctx.globalAlpha = 0.5
        ctx.drawImage(tmp, 0, 0)
        ctx.restore()
      }
    }

    // Active lasso outline (dashed) in any view.
    if (lassoPoints.length > 0) {
      ctx.save()
      ctx.strokeStyle = viewMode === "mask" ? "#ffffff" : PINK
      ctx.lineWidth = Math.max(1.5, W / 500)
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.moveTo(lassoPoints[0]!.x, lassoPoints[0]!.y)
      for (const p of lassoPoints.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
      ctx.restore()
    }
  }, [viewMode, lassoPoints])

  const snapshot = useCallback(() => {
    const mask = maskCanvasRef.current
    if (!mask) return
    const c = document.createElement("canvas")
    c.width = mask.width
    c.height = mask.height
    c.getContext("2d")!.drawImage(mask, 0, 0)
    undoStackRef.current.push(c)
    if (undoStackRef.current.length > UNDO_CAP) undoStackRef.current.shift()
    redoStackRef.current = []
    setCanUndo(true)
    setCanRedo(false)
  }, [])

  const restore = useCallback((c: HTMLCanvasElement) => {
    const ctx = maskCtx()
    const mask = maskCanvasRef.current
    if (!ctx || !mask) return
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, mask.width, mask.height)
    ctx.drawImage(c, 0, 0)
    compose()
    measureCoverage()
  }, [compose, measureCoverage])

  const handleUndo = useCallback(() => {
    const c = undoStackRef.current.pop()
    if (!c) return
    const mask = maskCanvasRef.current!
    const cur = document.createElement("canvas")
    cur.width = mask.width
    cur.height = mask.height
    cur.getContext("2d")!.drawImage(mask, 0, 0)
    redoStackRef.current.push(cur)
    restore(c)
    setCanUndo(undoStackRef.current.length > 0)
    setCanRedo(true)
  }, [restore])

  const handleRedo = useCallback(() => {
    const c = redoStackRef.current.pop()
    if (!c) return
    const mask = maskCanvasRef.current!
    const cur = document.createElement("canvas")
    cur.width = mask.width
    cur.height = mask.height
    cur.getContext("2d")!.drawImage(mask, 0, 0)
    undoStackRef.current.push(cur)
    restore(c)
    setCanRedo(redoStackRef.current.length > 0)
    setCanUndo(true)
  }, [restore])

  const fillAll = useCallback((color: "#ffffff" | "#000000") => {
    const ctx = maskCtx()
    const mask = maskCanvasRef.current
    if (!ctx || !mask) return
    snapshot()
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = color
    ctx.fillRect(0, 0, mask.width, mask.height)
    dirtyRef.current = true
    compose()
    measureCoverage()
  }, [snapshot, compose, measureCoverage])

  const handleInvert = useCallback(() => {
    const ctx = maskCtx()
    const mask = maskCanvasRef.current
    if (!ctx || !mask) return
    snapshot()
    ctx.globalCompositeOperation = "difference"
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, mask.width, mask.height)
    ctx.globalCompositeOperation = "source-over"
    dirtyRef.current = true
    compose()
    measureCoverage()
  }, [snapshot, compose, measureCoverage])

  const handleFeather = useCallback(() => {
    const ctx = maskCtx()
    const mask = maskCanvasRef.current
    const tmp = tmpCanvasRef.current
    if (!ctx || !mask || !tmp) return
    snapshot()
    const t = tmp.getContext("2d")!
    t.globalCompositeOperation = "source-over"
    t.clearRect(0, 0, mask.width, mask.height)
    t.drawImage(mask, 0, 0)
    ctx.filter = "blur(10px)"
    ctx.drawImage(tmp, 0, 0)
    ctx.filter = "none"
    dirtyRef.current = true
    compose()
    measureCoverage()
  }, [snapshot, compose, measureCoverage])

  // ── Open/reset + image/seed loading ──────────────────────────────────

  useEffect(() => {
    if (!isOpen) return
    setImgSize(null)
    setTool("brush")
    setViewMode("overlay")
    setBrushSize(initialBrushSize ?? 48)
    setHardness(initialBrushHardness ?? 70)
    setFlow(100)
    setZoom(100)
    setCoverage(0)
    setLassoPoints([])
    setCanUndo(false)
    setCanRedo(false)
    setSaving(false)
    undoStackRef.current = []
    redoStackRef.current = []
    dirtyRef.current = false
    imgRef.current = null
    maskCanvasRef.current = null

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      imgRef.current = img
      const w = img.naturalWidth
      const h = img.naturalHeight
      const mask = document.createElement("canvas")
      mask.width = w
      mask.height = h
      const mc = mask.getContext("2d")!
      mc.fillStyle = "#000000"
      mc.fillRect(0, 0, w, h)
      maskCanvasRef.current = mask
      const tmp = document.createElement("canvas")
      tmp.width = w
      tmp.height = h
      tmpCanvasRef.current = tmp
      setImgSize({ w, h })

      if (initialMaskUrl) {
        const seed = new Image()
        seed.crossOrigin = "anonymous"
        seed.onload = () => {
          mc.drawImage(seed, 0, 0, w, h)
          setImgSize({ w, h }) // retrigger compose effect
        }
        seed.src = getImageProxyUrl(initialMaskUrl)
      }
    }
    img.src = getImageProxyUrl(imageUrl)
  }, [isOpen, imageUrl, initialMaskUrl, initialBrushSize, initialBrushHardness])

  // Fit scale: size the displayed canvas to the stage.
  const computeFit = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !imgSize) return
    const pad = 48
    const availW = stage.clientWidth - pad
    const availH = stage.clientHeight - pad
    if (availW <= 0 || availH <= 0) return
    setFitScale(Math.min(availW / imgSize.w, availH / imgSize.h, 1))
  }, [imgSize])

  useEffect(() => {
    if (!isOpen || !imgSize) return
    computeFit()
    window.addEventListener("resize", computeFit)
    return () => window.removeEventListener("resize", computeFit)
  }, [isOpen, imgSize, computeFit])

  useEffect(() => {
    if (imgSize) compose()
  }, [imgSize, viewMode, lassoPoints, fitScale, zoom, compose])

  // ── Painting ─────────────────────────────────────────────────────────

  function canvasPoint(e: React.PointerEvent): { x: number; y: number } | null {
    const cv = canvasRef.current
    const mask = maskCanvasRef.current
    if (!cv || !mask) return null
    const r = cv.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (mask.width / r.width),
      y: (e.clientY - r.top) * (mask.height / r.height),
    }
  }

  const strokeSegment = useCallback((a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ctx = maskCtx()
    const cv = canvasRef.current
    const mask = maskCanvasRef.current
    if (!ctx || !cv || !mask) return
    const r = cv.getBoundingClientRect()
    const scale = mask.width / r.width
    const rad = (brushSize * scale) / 2
    const soft = 1 - hardness / 100
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = flow / 100
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = rad * 2
    if (soft > 0.02) ctx.filter = `blur(${(rad * soft * 0.5).toFixed(1)}px)`
    ctx.strokeStyle = tool === "eraser" ? "#000000" : "#ffffff"
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.filter = "none"
    ctx.globalAlpha = 1
  }, [brushSize, hardness, flow, tool])

  function closeLasso(pts: Array<{ x: number; y: number }>) {
    setLassoPoints([])
    if (pts.length < 3) return
    const ctx = maskCtx()
    if (!ctx) return
    snapshot()
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fill()
    dirtyRef.current = true
    compose()
    measureCoverage()
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    const pt = canvasPoint(e)
    if (!pt) return
    if (tool === "lasso") {
      const first = lassoPoints[0]
      const mask = maskCanvasRef.current
      const nearFirst = first && mask
        ? Math.hypot(pt.x - first.x, pt.y - first.y) < mask.width / 40
        : false
      if (lassoPoints.length > 2 && nearFirst) closeLasso(lassoPoints)
      else setLassoPoints((prev) => [...prev, pt])
      return
    }
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    snapshot()
    dirtyRef.current = true
    drawingRef.current = true
    lastPtRef.current = pt
    strokeSegment(pt, pt)
    compose()
  }

  function handlePointerMove(e: React.PointerEvent) {
    // Ring cursor follows the pointer over the stage.
    const cur = cursorRef.current
    const stage = stageRef.current
    if (cur && stage) {
      const wrap = stage.getBoundingClientRect()
      cur.style.opacity = "1"
      cur.style.width = cur.style.height = `${brushSize}px`
      cur.style.left = `${e.clientX - wrap.left}px`
      cur.style.top = `${e.clientY - wrap.top}px`
      cur.style.borderColor = tool === "eraser" ? "rgba(255,255,255,.55)" : "rgba(255,0,115,.95)"
    }
    if (!drawingRef.current) return
    const pt = canvasPoint(e)
    if (!pt || !lastPtRef.current) return
    strokeSegment(lastPtRef.current, pt)
    lastPtRef.current = pt
    compose()
  }

  function handlePointerUp() {
    if (drawingRef.current) {
      drawingRef.current = false
      lastPtRef.current = null
      measureCoverage()
    }
  }

  function handleStageLeave() {
    handlePointerUp()
    if (cursorRef.current) cursorRef.current.style.opacity = "0"
  }

  function handleDoubleClick() {
    if (tool === "lasso" && lassoPoints.length >= 3) closeLasso(lassoPoints)
  }

  // ── Keyboard ─────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
    if (e.key === "b") setTool("brush")
    if (e.key === "e") setTool("eraser")
    if (e.key === "l") setTool("lasso")
    if (e.key === "[") setBrushSize((s) => Math.max(4, s - 8))
    if (e.key === "]") setBrushSize((s) => Math.min(200, s + 8))
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo() }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); handleRedo() }
  }, [onClose, handleUndo, handleRedo])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  // ── Save ─────────────────────────────────────────────────────────────

  const hasContent = coverage > 0 || dirtyRef.current || !!initialMaskUrl

  async function handleSave() {
    const mask = maskCanvasRef.current
    if (!mask || saving) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        mask.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to create mask blob"))), "image/png")
      })
      // "mask.png" keeps painted masks identifiable in the asset library.
      const { url } = await uploadImage(blob, undefined, "mask.png")
      onSave(url)
      onClose()
    } catch {
      // uploadImage already surfaces errors via toast
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const displayW = imgSize ? imgSize.w * fitScale * (zoom / 100) : 0
  const baseName = urlBasename(imageUrl)

  const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <button
      key={t}
      type="button"
      onClick={() => { setTool(t); if (t !== "lasso") setLassoPoints([]) }}
      className="w-[52px] h-[50px] flex flex-col items-center justify-center gap-1 rounded-[11px] border transition-colors"
      style={tool === t
        ? { borderColor: PINK, background: "rgba(255,0,115,.14)", color: "#ff5c94" }
        : { borderColor: "#26262b", background: "#1c1c20", color: "#a1a1a8" }}
      title={label}
    >
      {icon}
      <span className="text-[9.5px] tracking-wide">{label}</span>
    </button>
  )

  const panelBtn = "h-[34px] rounded-[9px] border border-[#26262b] bg-[#1c1c20] text-[#c9c9d0] text-xs hover:bg-[#26262b] transition-colors"

  return createPortal(
    <div role="dialog" className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
      <div className="flex flex-col w-full max-w-[1180px] h-[min(760px,92vh)] bg-[#131316] border border-[#232327] rounded-[18px] overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,.65)]">

        {/* Header */}
        <div className="flex items-center justify-between gap-6 px-[18px] py-[14px] border-b border-[#232327] bg-[#151518]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-white" style={{ background: PINK }}>
              <Paintbrush className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="text-[#f4f4f5] text-sm font-medium leading-none">{tr("mediaed.maskEditorTitle")}</div>
              <div className="text-[#75757c] text-[11px] font-mono leading-none whitespace-nowrap overflow-hidden text-ellipsis">
                {baseName}{imgSize ? ` · ${imgSize.w} × ${imgSize.h}` : ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex bg-[#1c1c20] border border-[#26262b] rounded-[9px] p-[3px] gap-0.5">
              {(["overlay", "mask", "source"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewMode(v)}
                  className={`px-3.5 h-7 rounded-[7px] text-xs capitalize transition-colors ${viewMode === v ? "bg-[#2e2e34] text-[#f4f4f5]" : "text-[#8a8a92] hover:text-[#c9c9d0]"}`}
                >
                  {tr(VIEW_MODE_KEYS[v])}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-[9px] border border-[#26262b] bg-[#1c1c20] text-[#a1a1a8] hover:bg-[#26262b] hover:text-[#f4f4f5] flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">

          {/* Tool rail */}
          <div className="w-[76px] shrink-0 border-e border-[#232327] bg-[#151518] flex flex-col items-center gap-1.5 py-3.5">
            {toolBtn("brush", <Paintbrush className="w-[17px] h-[17px]" />, tr("mediaed.toolBrush"))}
            {toolBtn("eraser", <Eraser className="w-[17px] h-[17px]" />, tr("mediaed.toolErase"))}
            {toolBtn("lasso", <Triangle className="w-[17px] h-[17px]" />, tr("mediaed.toolShape"))}
            <div className="w-9 h-px bg-[#26262b] my-2" />
            <button type="button" onClick={handleUndo} disabled={!canUndo}
              className="w-[52px] h-11 flex flex-col items-center justify-center gap-1 rounded-[11px] text-[#75757c] hover:text-[#c9c9d0] disabled:opacity-30 transition-colors">
              <Undo2 className="w-4 h-4" /><span className="text-[9.5px]">{tr("ctb.undo")}</span>
            </button>
            <button type="button" onClick={handleRedo} disabled={!canRedo}
              className="w-[52px] h-11 flex flex-col items-center justify-center gap-1 rounded-[11px] text-[#75757c] hover:text-[#c9c9d0] disabled:opacity-30 transition-colors">
              <Redo2 className="w-4 h-4" /><span className="text-[9.5px]">{tr("ctb.redo")}</span>
            </button>
            <div className="flex-1" />
            <div className="text-[#4d4d54] text-[9px] font-mono text-center leading-relaxed px-2">B / E<br />[ ]</div>
          </div>

          {/* Stage */}
          <div
            ref={stageRef}
            className="relative flex-1 min-w-0 overflow-auto flex items-center justify-center bg-[#101012]"
            style={{ backgroundImage: "radial-gradient(#1d1d21 1px, transparent 1px)", backgroundSize: "22px 22px" }}
            onPointerLeave={handleStageLeave}
          >
            {imgSize ? (
              <div className="rounded-[10px] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,.55),0_0_0_1px_#2a2a30] m-6">
                <canvas
                  ref={canvasRef}
                  width={imgSize.w}
                  height={imgSize.h}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onDoubleClick={handleDoubleClick}
                  className="block touch-none"
                  style={{ width: `${displayW}px`, height: "auto", cursor: tool === "lasso" ? "crosshair" : "none" }}
                />
              </div>
            ) : (
              <Loader2 className="w-8 h-8 animate-spin text-[#4f4f57]" />
            )}

            {/* Ring cursor */}
            <div
              ref={cursorRef}
              className="absolute start-0 top-0 rounded-full pointer-events-none opacity-0 -translate-x-1/2 -translate-y-1/2"
              style={{ border: "1.5px solid rgba(255,255,255,.9)", boxShadow: "0 0 0 1px rgba(0,0,0,.5) inset, 0 0 0 1px rgba(0,0,0,.4)" }}
            />

            {/* Coverage pill */}
            <div className="absolute start-4 top-3.5 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[rgba(19,19,22,.82)] border border-[#26262b] backdrop-blur-md">
              <div className="w-2 h-2 rounded-[2px]" style={{ background: PINK }} />
              <div className="text-[#c9c9d0] text-[11px] font-mono whitespace-nowrap">{tr("mediaed.coverageLine", { pct: coverage })}</div>
            </div>

            {/* Zoom pill */}
            <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-1 rounded-[9px] bg-[rgba(19,19,22,.82)] border border-[#26262b] backdrop-blur-md">
              <button type="button" onClick={() => setZoom((z) => Math.max(25, z - 25))} className="min-w-7 h-6 px-2 rounded-md text-[#c9c9d0] text-xs hover:bg-white/5">−</button>
              <div className="min-w-[52px] text-center text-[#c9c9d0] text-[11px] font-mono">{zoom}%</div>
              <button type="button" onClick={() => setZoom((z) => Math.min(400, z + 25))} className="min-w-7 h-6 px-2 rounded-md text-[#c9c9d0] text-xs hover:bg-white/5">+</button>
              <div className="w-px h-4 bg-[#2c2c32] mx-1" />
              <button type="button" onClick={() => setZoom(100)} className="min-w-7 h-6 px-2 rounded-md text-[#c9c9d0] text-xs hover:bg-white/5">{tr("mediaed.zoomFit")}</button>
            </div>
          </div>

          {/* Right panel */}
          <div className="w-[264px] shrink-0 border-s border-[#232327] bg-[#151518] flex flex-col gap-[22px] px-[18px] pt-[18px] pb-5 overflow-y-auto">
            <div className="flex flex-col gap-3.5">
              <div className="text-[#75757c] text-[10px] font-medium tracking-[.12em] uppercase">{tr("mediaed.toolBrush")}</div>
              {([
                { label: tr("cfgext.paintBrushSize"), value: brushSize, suffix: " px", min: 4, max: 200, set: setBrushSize },
                { label: tr("cfgext.paintBrushHardness"), value: hardness, suffix: "%", min: 0, max: 100, set: setHardness },
                { label: tr("mediaed.brushFlow"), value: flow, suffix: "%", min: 10, max: 100, set: setFlow },
              ] as const).map((s) => (
                <div key={s.label} className="flex flex-col gap-[7px]">
                  <div className="flex justify-between items-baseline">
                    <span className="text-[#c9c9d0] text-xs">{s.label}</span>
                    <span className="text-[#f4f4f5] text-xs font-mono">{s.value}{s.suffix}</span>
                  </div>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    value={s.value}
                    onChange={(e) => s.set(Number(e.target.value))}
                    className="w-full accent-[#ff0073]"
                  />
                </div>
              ))}
            </div>

            <div className="h-px bg-[#232327]" />

            <div className="flex flex-col gap-3">
              <div className="text-[#75757c] text-[10px] font-medium tracking-[.12em] uppercase">{tr("mediaed.selectionHeader")}</div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => fillAll("#ffffff")} className={panelBtn}>{tr("canvas.selectAll")}</button>
                <button type="button" onClick={handleInvert} className={panelBtn}>{tr("mediaed.invert")}</button>
                <button type="button" onClick={() => fillAll("#000000")} className={panelBtn}>{tr("common.clear")}</button>
                <button type="button" onClick={handleFeather} className={panelBtn}>{tr("mediaed.feather")}</button>
              </div>
            </div>

            <div className="h-px bg-[#232327]" />

            <div className="flex flex-col gap-3">
              <div className="text-[#75757c] text-[10px] font-medium tracking-[.12em] uppercase">{tr("mediaed.legend")}</div>
              <div className="flex items-center gap-2.5">
                <div className="w-[26px] h-[26px] rounded-md bg-white shrink-0" />
                <div className="flex flex-col gap-px">
                  <span className="text-[#f4f4f5] text-xs">{tr("mediaed.legendWhite")}</span>
                  <span className="text-[#75757c] text-[11px]">{tr("mediaed.legendWhiteHint")}</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-[26px] h-[26px] rounded-md bg-black border border-[#2c2c32] shrink-0" />
                <div className="flex flex-col gap-px">
                  <span className="text-[#f4f4f5] text-xs">{tr("mediaed.legendBlack")}</span>
                  <span className="text-[#75757c] text-[11px]">{tr("mediaed.legendBlackHint")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-[18px] py-3.5 border-t border-[#232327] bg-[#151518]">
          <div className="text-[#75757c] text-[11.5px]">{tr("mediaed.maskFooterHint")}</div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-[18px] h-[38px] rounded-[10px] border border-[#2c2c32] bg-transparent text-[#c9c9d0] text-[13px] hover:bg-[#1f1f24] hover:text-[#f4f4f5] transition-colors"
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasContent || !imgSize}
              className="px-[22px] h-[38px] rounded-[10px] text-white text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors hover:opacity-90"
              style={{ background: PINK }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {tr("mediaed.saveMask")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
