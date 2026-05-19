"use client"

import { useEffect, useCallback, useState, useRef } from "react"
import { createPortal } from "react-dom"
import {
  X, Paintbrush, Eraser, Triangle, RotateCcw, ArrowRightLeft,
  Undo2, Redo2, Loader2,
} from "lucide-react"
import { uploadImage, getImageProxyUrl } from "@/lib/api"
import { generateMaskBlob, paintStrokeOnCtx } from "@/lib/mask-utils"
import type { MaskStroke } from "@/lib/mask-utils"

type Tool = "brush" | "eraser" | "lasso"
type ViewMode = "overlay" | "mask" | "source"

interface MaskPainterModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly imageUrl: string
  readonly initialMaskUrl?: string
  readonly onSave: (maskUrl: string) => void
}

export function MaskPainterModal({
  isOpen, onClose, imageUrl, initialMaskUrl, onSave,
}: MaskPainterModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgElRef = useRef<HTMLImageElement>(null)
  const activeStrokeRef = useRef<MaskStroke | null>(null)

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const imageLoaded = imgSize !== null
  const [tool, setTool] = useState<Tool>("brush")
  const [brushSize, setBrushSize] = useState(30)
  const [opacity, setOpacity] = useState(100)
  const [viewMode, setViewMode] = useState<ViewMode>("overlay")
  const [strokes, setStrokes] = useState<MaskStroke[]>([])
  const [redoStack, setRedoStack] = useState<MaskStroke[]>([])
  const [lassoPoints, setLassoPoints] = useState<Array<{ x: number; y: number }>>([])
  const [baseImageData, setBaseImageData] = useState<ImageData | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset on open
  useEffect(() => {
    if (!isOpen) return
    setStrokes([])
    setRedoStack([])
    setLassoPoints([])
    setBaseImageData(null)
    activeStrokeRef.current = null
    setImgSize(null)
    setTool("brush")
    setBrushSize(30)
    setOpacity(100)
    setViewMode("overlay")
    setSaving(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !initialMaskUrl || !imgSize) return
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const offscreen = document.createElement("canvas")
      offscreen.width = imgSize.w
      offscreen.height = imgSize.h
      const ctx = offscreen.getContext("2d")!
      ctx.drawImage(img, 0, 0, imgSize.w, imgSize.h)
      setBaseImageData(ctx.getImageData(0, 0, imgSize.w, imgSize.h))
    }
    img.src = getImageProxyUrl(initialMaskUrl)
  }, [isOpen, initialMaskUrl, imgSize])

  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev
      const popped = prev[prev.length - 1]
      setRedoStack((r) => [...r, popped])
      return prev.slice(0, -1)
    })
  }, [])

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev
      const top = prev[prev.length - 1]
      setStrokes((s) => [...s, top])
      return prev.slice(0, -1)
    })
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
    if (e.key === "b") setTool("brush")
    if (e.key === "e") setTool("eraser")
    if (e.key === "l") setTool("lasso")
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo() }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); handleRedo() }
  }, [onClose, handleUndo, handleRedo])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  function handleImageLoad() {
    const img = imgElRef.current
    if (!img) return
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
  }

  useEffect(() => {
    if (!imageLoaded) return
    const raf = requestAnimationFrame(() => syncCanvasSize())
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageLoaded, imgSize])

  function syncCanvasSize() {
    const img = imgElRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    const { width, height } = img.getBoundingClientRect()
    canvas.width = width
    canvas.height = height
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    redrawOverlay()
  }

  function getScale() {
    const img = imgElRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return { scaleX: 1, scaleY: 1 }
    return {
      scaleX: img.naturalWidth / canvas.width,
      scaleY: img.naturalHeight / canvas.height,
    }
  }

  function drawLassoOutline(ctx: CanvasRenderingContext2D, color: string, scaleX: number, scaleY: number) {
    if (lassoPoints.length === 0) return
    ctx.globalCompositeOperation = "source-over"
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(lassoPoints[0].x / scaleX, lassoPoints[0].y / scaleY)
    for (const p of lassoPoints.slice(1)) ctx.lineTo(p.x / scaleX, p.y / scaleY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  function redrawOverlay() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const { scaleX, scaleY } = getScale()

    if (viewMode === "source") return

    const allStrokes = [...strokes, ...(activeStrokeRef.current ? [activeStrokeRef.current] : [])]

    if (viewMode === "mask") {
      ctx.fillStyle = "#000000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (baseImageData && imgSize) {
        const offscreen = document.createElement("canvas")
        offscreen.width = imgSize.w
        offscreen.height = imgSize.h
        const offCtx = offscreen.getContext("2d")!
        offCtx.putImageData(baseImageData, 0, 0)
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height)
      }
      ctx.globalCompositeOperation = "source-over"
      for (const stroke of allStrokes) {
        ctx.fillStyle = stroke.isEraser ? "#000000" : "#ffffff"
        paintStrokeOnCtx(ctx, stroke, scaleX, scaleY)
      }
      drawLassoOutline(ctx, "#ffffff", scaleX, scaleY)
      return
    }

    for (const stroke of allStrokes) {
      ctx.fillStyle = `rgba(239, 68, 68, ${0.4 * (stroke.opacity ?? 1)})`
      ctx.globalCompositeOperation = stroke.isEraser ? "destination-out" : "source-over"
      paintStrokeOnCtx(ctx, stroke, scaleX, scaleY)
    }
    drawLassoOutline(ctx, "rgba(239, 68, 68, 0.9)", scaleX, scaleY)
    ctx.globalCompositeOperation = "source-over"
  }

  useEffect(() => {
    if (imageLoaded) redrawOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, imageLoaded, viewMode, lassoPoints, baseImageData])

  function getCanvasPoint(e: React.MouseEvent) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { scaleX, scaleY } = getScale()
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function isNearFirst(pt: { x: number; y: number }) {
    if (lassoPoints.length === 0) return false
    const first = lassoPoints[0]
    const { scaleX } = getScale()
    return Math.hypot(pt.x - first.x, pt.y - first.y) < 12 * scaleX
  }

  function closeLasso(pts: Array<{ x: number; y: number }>) {
    if (pts.length < 3) { setLassoPoints([]); return }
    const stroke: MaskStroke = {
      points: pts,
      radius: 0,
      isEraser: tool === "eraser",
      isLasso: true,
      opacity: opacity / 100,
    }
    setStrokes((prev) => [...prev, stroke])
    setRedoStack([])
    setLassoPoints([])
  }

  function handlePointerDown(e: React.MouseEvent) {
    e.preventDefault()
    const pt = getCanvasPoint(e)
    if (!pt) return

    if (tool === "lasso") {
      if (lassoPoints.length > 0 && isNearFirst(pt)) {
        closeLasso(lassoPoints)
      } else {
        setLassoPoints((prev) => [...prev, pt])
      }
      return
    }

    activeStrokeRef.current = {
      points: [pt],
      radius: brushSize,
      isEraser: tool === "eraser",
      opacity: opacity / 100,
    }
    redrawOverlay()
  }

  function handlePointerMove(e: React.MouseEvent) {
    if (!activeStrokeRef.current) return
    const pt = getCanvasPoint(e)
    if (!pt) return
    activeStrokeRef.current.points.push(pt)
    redrawOverlay()
  }

  function handlePointerUp() {
    const stroke = activeStrokeRef.current
    if (!stroke) return
    activeStrokeRef.current = null
    setStrokes((prev) => [...prev, stroke])
    setRedoStack([])
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (tool !== "lasso" || lassoPoints.length < 3) return
    e.preventDefault()
    closeLasso(lassoPoints)
  }

  function handleClear() {
    setStrokes([])
    setRedoStack([])
    setLassoPoints([])
    activeStrokeRef.current = null
  }

  function handleInvert() {
    const fullFill: MaskStroke = { points: [], radius: 0, isEraser: false, fill: true }
    setStrokes((prev) => [fullFill, ...prev.map((s) => ({ ...s, isEraser: !s.isEraser }))])
    setRedoStack([])
  }

  async function handleSave() {
    if (!imgSize) return
    if (strokes.length === 0 && !baseImageData) return
    setSaving(true)
    try {
      const blob = await generateMaskBlob(imgSize.w, imgSize.h, strokes, baseImageData ?? undefined)
      const { url } = await uploadImage(blob)
      onSave(url)
      onClose()
    } catch {
      // uploadImage already shows errors via toast
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const hasContent = strokes.length > 0 || !!baseImageData

  return createPortal(
    <div role="dialog" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative flex flex-col bg-[#1E1E1E] rounded-2xl border border-[#2D2D2D] shadow-2xl max-w-[90vw] max-h-[90vh] overflow-hidden">

        {/* Toolbar (layout B: single horizontal row) */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2D2D2D] flex-wrap">
          {/* Tools */}
          {(["brush", "eraser", "lasso"] as Tool[]).map((t) => (
            <button
              key={t}
              type="button"
              title={t === "brush" ? "Brush (B)" : t === "eraser" ? "Eraser (E)" : "Lasso (L)"}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${tool === t ? "bg-[#ff0073] text-white" : "bg-[#2D2D2D] text-white/60 hover:text-white"}`}
              onClick={() => setTool(t)}
            >
              {t === "brush" && <Paintbrush className="w-4 h-4" />}
              {t === "eraser" && <Eraser className="w-4 h-4" />}
              {t === "lasso" && <Triangle className="w-4 h-4" />}
            </button>
          ))}

          <div className="w-px h-5 bg-[#2D2D2D] mx-1" />

          {/* Size */}
          <label className="text-[11px] text-white/40">Size</label>
          <input type="range" min={5} max={80} value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-20 accent-[#ff0073]" disabled={tool === "lasso"} />
          <span className="text-[11px] text-white/40 w-6">{brushSize}</span>

          {/* Opacity */}
          <label className="text-[11px] text-white/40 ml-1">Opacity</label>
          <input type="range" min={10} max={100} step={10} value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-20 accent-[#ff0073]" />
          <span className="text-[11px] text-white/40 w-8">{opacity}%</span>

          <div className="w-px h-5 bg-[#2D2D2D] mx-1" />

          {/* Undo / Redo */}
          <button type="button" title="Undo (Ctrl+Z)" onClick={handleUndo}
            disabled={strokes.length === 0}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2D2D2D] text-white/60 hover:text-white disabled:opacity-30 transition-colors">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" title="Redo (Ctrl+Y)" onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2D2D2D] text-white/60 hover:text-white disabled:opacity-30 transition-colors">
            <Redo2 className="w-4 h-4" />
          </button>
          <button type="button" title="Invert mask" onClick={handleInvert}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2D2D2D] text-white/60 hover:text-white transition-colors">
            <ArrowRightLeft className="w-4 h-4" />
          </button>
          <button type="button" title="Clear mask" onClick={handleClear}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2D2D2D] text-white/60 hover:text-white transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* View toggle */}
          <div className="ml-auto flex items-center rounded-lg overflow-hidden border border-[#2D2D2D]">
            {(["overlay", "mask", "source"] as ViewMode[]).map((v) => (
              <button key={v} type="button"
                className={`px-2.5 py-1 text-[11px] capitalize transition-colors ${viewMode === v ? "bg-[#2D2D2D] text-white" : "text-white/40 hover:text-white"}`}
                onClick={() => setViewMode(v)}>
                {v}
              </button>
            ))}
          </div>

          <button type="button" onClick={onClose} className="ml-2 text-white/40 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Canvas area */}
        <div className="relative flex-1 overflow-auto p-4">
          <div className="relative inline-block">
            <img
              ref={imgElRef}
              src={getImageProxyUrl(imageUrl)}
              alt="Source"
              crossOrigin="anonymous"
              onLoad={handleImageLoad}
              className={`max-w-full max-h-[70vh] rounded-lg select-none ${viewMode === "mask" ? "opacity-0" : ""}`}
              draggable={false}
            />
            {imageLoaded && (
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 cursor-crosshair"
                style={{ touchAction: "none" }}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onDoubleClick={handleDoubleClick}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[#2D2D2D]">
          <p className="text-[11px] text-white/30">White = edit area · Black = preserve</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors">
              Cancel
            </button>
            <button type="button" onClick={handleSave}
              disabled={saving || !hasContent}
              className="px-4 py-2 text-sm bg-[#ff0073] text-white rounded-lg hover:bg-[#ff0073]/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Mask
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
