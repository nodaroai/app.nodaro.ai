"use client"

import { useEffect, useCallback, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Paintbrush, Eraser, RotateCcw, ArrowRightLeft, Loader2 } from "lucide-react"
import { uploadImage, getImageProxyUrl } from "@/lib/api"
import { generateMaskBlob } from "@/lib/mask-utils"
import type { MaskStroke } from "@/lib/mask-utils"

type Tool = "brush" | "eraser"

interface MaskPainterModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly imageUrl: string
  readonly onSave: (maskUrl: string) => void
}

export function MaskPainterModal({ isOpen, onClose, imageUrl, onSave }: MaskPainterModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgElRef = useRef<HTMLImageElement>(null)
  // Mutable ref for in-progress stroke to avoid O(n²) array copying on every mouse move
  const activeStrokeRef = useRef<MaskStroke | null>(null)

  const [imageLoaded, setImageLoaded] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [tool, setTool] = useState<Tool>("brush")
  const [brushSize, setBrushSize] = useState(30)
  const [strokes, setStrokes] = useState<MaskStroke[]>([])
  const [saving, setSaving] = useState(false)

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setStrokes([])
      activeStrokeRef.current = null
      setImageLoaded(false)
      setImgSize(null)
      setTool("brush")
      setBrushSize(30)
      setSaving(false)
    }
  }, [isOpen])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
    if (e.key === "b") setTool("brush")
    if (e.key === "e") setTool("eraser")
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  function handleImageLoad() {
    const img = imgElRef.current
    if (!img) return
    setImageLoaded(true)
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

  function getScale(): { scaleX: number; scaleY: number } {
    const img = imgElRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return { scaleX: 1, scaleY: 1 }
    return {
      scaleX: img.naturalWidth / canvas.width,
      scaleY: img.naturalHeight / canvas.height,
    }
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: MaskStroke, scaleX: number, scaleY: number) {
    if (stroke.fill) {
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      return
    }
    ctx.beginPath()
    for (const pt of stroke.points) {
      const cx = pt.x / scaleX
      const cy = pt.y / scaleY
      const r = stroke.radius / scaleX
      ctx.moveTo(cx + r, cy)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  function redrawOverlay() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const { scaleX, scaleY } = getScale()

    const allStrokes = [...strokes, ...(activeStrokeRef.current ? [activeStrokeRef.current] : [])]
    for (const stroke of allStrokes) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.4)" // red overlay for mask area
      ctx.globalCompositeOperation = stroke.isEraser ? "destination-out" : "source-over"
      drawStroke(ctx, stroke, scaleX, scaleY)
    }
    ctx.globalCompositeOperation = "source-over"
  }

  // Re-render overlay whenever committed strokes change
  useEffect(() => {
    if (imageLoaded) redrawOverlay()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, imageLoaded])

  function getCanvasPoint(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { scaleX, scaleY } = getScale()
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function handlePointerDown(e: React.MouseEvent) {
    e.preventDefault()
    const pt = getCanvasPoint(e)
    activeStrokeRef.current = {
      points: [pt],
      radius: brushSize,
      isEraser: tool === "eraser",
    }
    redrawOverlay()
  }

  function handlePointerMove(e: React.MouseEvent) {
    if (!activeStrokeRef.current) return
    const pt = getCanvasPoint(e)
    activeStrokeRef.current.points.push(pt)
    redrawOverlay()
  }

  function handlePointerUp() {
    if (!activeStrokeRef.current) return
    setStrokes((prev) => [...prev, activeStrokeRef.current!])
    activeStrokeRef.current = null
  }

  function handleClear() {
    setStrokes([])
    activeStrokeRef.current = null
  }

  function handleInvert() {
    const fullFill: MaskStroke = { points: [], radius: 0, isEraser: false, fill: true }
    const inverted = strokes.map((s) => ({ ...s, isEraser: !s.isEraser }))
    setStrokes([fullFill, ...inverted])
  }

  async function handleSave() {
    if (!imgSize || strokes.length === 0) return
    setSaving(true)
    try {
      const blob = await generateMaskBlob(imgSize.w, imgSize.h, strokes)
      const { url } = await uploadImage(blob)
      onSave(url)
      onClose()
    } catch {
      // uploadImage already shows errors
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative flex flex-col bg-[#1E1E1E] rounded-2xl border border-[#2D2D2D] shadow-2xl max-w-[90vw] max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D2D2D]">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium text-white">Paint Mask</h3>

            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${tool === "brush" ? "bg-[#ff0073] text-white" : "bg-[#2D2D2D] text-white/60 hover:text-white"}`}
                onClick={() => setTool("brush")}
                title="Brush (B)"
              >
                <Paintbrush className="w-4 h-4" />
              </button>
              <button
                type="button"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${tool === "eraser" ? "bg-[#ff0073] text-white" : "bg-[#2D2D2D] text-white/60 hover:text-white"}`}
                onClick={() => setTool("eraser")}
                title="Eraser (E)"
              >
                <Eraser className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 ml-2">
              <label className="text-[11px] text-white/50">Size</label>
              <input
                type="range"
                min={5}
                max={80}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-20 accent-[#ff0073]"
              />
              <span className="text-[11px] text-white/50 w-6">{brushSize}</span>
            </div>

            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2D2D2D] text-white/60 hover:text-white transition-colors"
                onClick={handleInvert}
                title="Invert mask"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#2D2D2D] text-white/60 hover:text-white transition-colors"
                onClick={handleClear}
                title="Clear mask"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="relative flex-1 overflow-auto p-4">
          <div className="relative inline-block">
            <img
              ref={imgElRef}
              src={getImageProxyUrl(imageUrl)}
              alt="Source"
              crossOrigin="anonymous"
              onLoad={handleImageLoad}
              className="max-w-full max-h-[70vh] rounded-lg select-none"
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
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#2D2D2D]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || strokes.length === 0}
            className="px-4 py-2 text-sm bg-[#ff0073] text-white rounded-lg hover:bg-[#ff0073]/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Mask
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
