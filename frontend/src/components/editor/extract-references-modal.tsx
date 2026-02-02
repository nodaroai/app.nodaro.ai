"use client"

import { useEffect, useCallback, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Scissors, User, MapPin, Loader2, AlertTriangle, Square, Pen } from "lucide-react"
import { cropImageElementToBlob, cropPolygonToBlob, polygonBoundingBox } from "@/lib/image-utils"
import type { Point } from "@/lib/image-utils"
import { uploadImage, getImageProxyUrl } from "@/lib/api"
import type { ExtractedReference } from "@/types/nodes"

type SelectionMode = "rectangle" | "lasso"

interface DrawRect {
  startX: number
  startY: number
  endX: number
  endY: number
}

interface PendingExtraction {
  mode: SelectionMode
  rect?: DrawRect
  lassoPoints?: Point[]
  name: string
  type: "character" | "location"
}

interface ExtractReferencesModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly imageUrl: string
  readonly sceneIndex: number
  readonly sceneCharacters: readonly string[]
  readonly existingReferences: readonly ExtractedReference[]
  readonly onSave: (references: readonly ExtractedReference[]) => void
  readonly suggestedMessage?: string
}

export function ExtractReferencesModal({
  isOpen,
  onClose,
  imageUrl,
  sceneIndex,
  sceneCharacters,
  existingReferences,
  onSave,
  suggestedMessage,
}: ExtractReferencesModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgElRef = useRef<HTMLImageElement>(null)

  const [imageLoaded, setImageLoaded] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("lasso")
  const [drawing, setDrawing] = useState(false)
  const [currentRect, setCurrentRect] = useState<DrawRect | null>(null)
  const [lassoPoints, setLassoPoints] = useState<Point[]>([])
  const [pending, setPending] = useState<PendingExtraction | null>(null)
  const [references, setReferences] = useState<readonly ExtractedReference[]>(existingReferences)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState("")
  const [typeInput, setTypeInput] = useState<"character" | "location">("character")

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setReferences(existingReferences)
      setPending(null)
      setCurrentRect(null)
      setLassoPoints([])
      setError(null)
      setImageLoaded(false)
      setImgSize(null)
    }
  }, [isOpen, existingReferences])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (pending) {
        setPending(null)
        setCurrentRect(null)
        setLassoPoints([])
      } else {
        onClose()
      }
    }
  }, [onClose, pending])

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

  // Sync canvas size to match displayed image
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
    drawOverlay(null, [])
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

  function drawOverlay(rect: DrawRect | null, lasso: Point[]) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw existing reference boxes
    const { scaleX, scaleY } = getScale()
    for (const ref of references) {
      if (ref.sourceSceneIndex === sceneIndex) {
        const x = ref.boundingBox.x / scaleX
        const y = ref.boundingBox.y / scaleY
        const bw = ref.boundingBox.width / scaleX
        const bh = ref.boundingBox.height / scaleY
        ctx.strokeStyle = ref.type === "character" ? "#a855f7" : "#3b82f6"
        ctx.lineWidth = 2
        ctx.setLineDash([])
        ctx.strokeRect(x, y, bw, bh)
        const label = ref.name
        ctx.font = "bold 11px sans-serif"
        const metrics = ctx.measureText(label)
        ctx.fillStyle = ref.type === "character" ? "rgba(168,85,247,0.85)" : "rgba(59,130,246,0.85)"
        ctx.fillRect(x, y - 16, metrics.width + 6, 16)
        ctx.fillStyle = "#fff"
        ctx.fillText(label, x + 3, y - 4)
      }
    }

    // Draw rectangle selection
    if (rect) {
      const x = Math.min(rect.startX, rect.endX)
      const y = Math.min(rect.startY, rect.endY)
      const rw = Math.abs(rect.endX - rect.startX)
      const rh = Math.abs(rect.endY - rect.startY)
      ctx.strokeStyle = "#ef4444"
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(x, y, rw, rh)
      ctx.setLineDash([])
      ctx.fillStyle = "rgba(0,0,0,0.25)"
      ctx.fillRect(0, 0, canvas.width, y)
      ctx.fillRect(0, y + rh, canvas.width, canvas.height - y - rh)
      ctx.fillRect(0, y, x, rh)
      ctx.fillRect(x + rw, y, canvas.width - x - rw, rh)
    }

    // Draw lasso path
    if (lasso.length > 0) {
      ctx.beginPath()
      ctx.moveTo(lasso[0].x, lasso[0].y)
      for (let i = 1; i < lasso.length; i++) {
        ctx.lineTo(lasso[i].x, lasso[i].y)
      }
      // If not actively drawing, close the path
      if (!drawing && lasso.length > 2) {
        ctx.closePath()
      }
      ctx.strokeStyle = "#ef4444"
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.stroke()

      // Fill with semi-transparent while drawing
      if (lasso.length > 2) {
        ctx.fillStyle = "rgba(239,68,68,0.1)"
        ctx.fill()
      }

      // Draw points
      for (const p of lasso) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = "#ef4444"
        ctx.fill()
      }
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (pending) return
    const canvas = canvasRef.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top

    if (selectionMode === "rectangle") {
      setDrawing(true)
      setCurrentRect({ startX: x, startY: y, endX: x, endY: y })
      setLassoPoints([])
    } else {
      // Lasso mode
      setDrawing(true)
      setLassoPoints([{ x, y }])
      setCurrentRect(null)
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top

    if (selectionMode === "rectangle" && currentRect) {
      const newRect = { ...currentRect, endX: x, endY: y }
      setCurrentRect(newRect)
      drawOverlay(newRect, [])
    } else if (selectionMode === "lasso") {
      // Sample points (skip if too close to last point)
      const last = lassoPoints[lassoPoints.length - 1]
      if (last) {
        const dist = Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2)
        if (dist < 4) return
      }
      const newPoints = [...lassoPoints, { x, y }]
      setLassoPoints(newPoints)
      drawOverlay(null, newPoints)
    }
  }

  function handleMouseUp() {
    if (!drawing) return
    setDrawing(false)

    if (selectionMode === "rectangle" && currentRect) {
      const w = Math.abs(currentRect.endX - currentRect.startX)
      const h = Math.abs(currentRect.endY - currentRect.startY)
      if (w < 20 || h < 20) {
        setCurrentRect(null)
        drawOverlay(null, [])
        return
      }
      finishSelection({ mode: "rectangle", rect: currentRect })
    } else if (selectionMode === "lasso" && lassoPoints.length >= 3) {
      // Close the lasso and check size
      const { scaleX, scaleY } = getScale()
      const naturalPoints = lassoPoints.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }))
      const bbox = polygonBoundingBox(naturalPoints)
      if (bbox.width < 20 || bbox.height < 20) {
        setLassoPoints([])
        drawOverlay(null, [])
        return
      }
      // Redraw with closed path
      drawOverlay(null, lassoPoints)
      finishSelection({ mode: "lasso", lassoPoints })
    } else {
      setLassoPoints([])
      drawOverlay(null, [])
    }
  }

  function finishSelection(sel: { mode: SelectionMode; rect?: DrawRect; lassoPoints?: Point[] }) {
    const existingNames = new Set(references.map((r) => r.name))
    const suggestion = sceneCharacters.find((c) => !existingNames.has(c)) ?? ""

    setPending({
      ...sel,
      name: suggestion,
      type: "character",
    })
    setNameInput(suggestion)
    setTypeInput("character")
  }

  async function handleConfirmExtraction() {
    if (!pending || !nameInput.trim()) return
    const img = imgElRef.current
    if (!img) return
    setError(null)
    setSaving(true)

    try {
      const { scaleX, scaleY } = getScale()
      let blob: Blob
      let boundingBox: { x: number; y: number; width: number; height: number }

      if (pending.mode === "rectangle" && pending.rect) {
        const x = Math.min(pending.rect.startX, pending.rect.endX) * scaleX
        const y = Math.min(pending.rect.startY, pending.rect.endY) * scaleY
        const w = Math.abs(pending.rect.endX - pending.rect.startX) * scaleX
        const h = Math.abs(pending.rect.endY - pending.rect.startY) * scaleY

        if (w < 64 || h < 64) {
          setError("Selection too small. Minimum 64x64 pixels recommended.")
          setSaving(false)
          return
        }

        boundingBox = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
        blob = await cropImageElementToBlob(img, boundingBox)
      } else if (pending.mode === "lasso" && pending.lassoPoints) {
        const naturalPoints = pending.lassoPoints.map((p) => ({
          x: p.x * scaleX,
          y: p.y * scaleY,
        }))
        boundingBox = polygonBoundingBox(naturalPoints)

        if (boundingBox.width < 64 || boundingBox.height < 64) {
          setError("Selection too small. Minimum 64x64 pixels recommended.")
          setSaving(false)
          return
        }

        blob = await cropPolygonToBlob(img, naturalPoints)
      } else {
        setSaving(false)
        return
      }

      const { url } = await uploadImage(blob)

      const newRef: ExtractedReference = {
        id: crypto.randomUUID(),
        name: nameInput.trim(),
        type: typeInput,
        imageUrl: url,
        sourceSceneIndex: sceneIndex,
        boundingBox,
      }

      setReferences([...references, newRef])
      setPending(null)
      setCurrentRect(null)
      setLassoPoints([])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract reference")
    } finally {
      setSaving(false)
    }
  }

  function handleDeleteReference(id: string) {
    setReferences(references.filter((r) => r.id !== id))
  }

  function handleSave() {
    onSave(references)
    onClose()
  }

  function handleCancelPending() {
    setPending(null)
    setCurrentRect(null)
    setLassoPoints([])
    drawOverlay(null, [])
  }

  // Redraw overlay when references change
  useEffect(() => {
    if (imageLoaded) drawOverlay(currentRect, lassoPoints)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references, imageLoaded])

  if (!isOpen) return null

  const characters = references.filter((r) => r.type === "character")
  const locations = references.filter((r) => r.type === "location")

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative w-[90vw] max-w-3xl max-h-[90vh] bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <Scissors className="w-4 h-4 text-purple-500" />
            <h2 className="text-sm font-semibold">Extract References from Scene {sceneIndex + 1}</h2>
          </div>
          {suggestedMessage && (
            <p className="text-xs text-orange-500 font-medium">{suggestedMessage}</p>
          )}
          <div className="flex items-center gap-2">
            {/* Selection mode toggle */}
            <div className="flex rounded-md border overflow-hidden">
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                  selectionMode === "lasso" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                }`}
                onClick={() => setSelectionMode("lasso")}
                title="Freeform lasso selection"
              >
                <Pen className="w-3 h-3" /> Lasso
              </button>
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                  selectionMode === "rectangle" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                }`}
                onClick={() => setSelectionMode("rectangle")}
                title="Rectangle selection"
              >
                <Square className="w-3 h-3" /> Rect
              </button>
            </div>
            <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Image + canvas overlay area */}
        <div className="flex-1 overflow-auto p-4">
          <div className="relative flex justify-center">
            <img
              ref={imgElRef}
              src={getImageProxyUrl(imageUrl)}
              crossOrigin="anonymous"
              alt={`Scene ${sceneIndex + 1}`}
              className="max-w-full max-h-[500px] rounded-md border object-contain"
              onLoad={handleImageLoad}
            />
            {imageLoaded && (
              <canvas
                ref={canvasRef}
                className={`absolute top-0 left-1/2 -translate-x-1/2 rounded-md ${
                  pending ? "cursor-not-allowed" : selectionMode === "lasso" ? "cursor-crosshair" : "cursor-crosshair"
                }`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { if (drawing) handleMouseUp() }}
              />
            )}
          </div>

          {!pending && imageLoaded && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              {selectionMode === "lasso"
                ? "Click and drag to draw around the character or location"
                : "Click and drag to draw a rectangle selection"}
            </p>
          )}

          {!imageLoaded && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Pending extraction form */}
          {pending && (
            <div className="mt-3 p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Name (e.g. Hero, Castle)"
                  className="flex-1 h-8 px-3 text-sm rounded-md border bg-background outline-none focus:ring-1 focus:ring-purple-500"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirmExtraction() }}
                  autoFocus
                />
                <div className="flex rounded-md border overflow-hidden">
                  <button
                    type="button"
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      typeInput === "character" ? "bg-purple-600 text-white" : "bg-muted hover:bg-muted/80"
                    }`}
                    onClick={() => setTypeInput("character")}
                  >
                    <User className="w-3 h-3" /> Character
                  </button>
                  <button
                    type="button"
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      typeInput === "location" ? "bg-blue-600 text-white" : "bg-muted hover:bg-muted/80"
                    }`}
                    onClick={() => setTypeInput("location")}
                  >
                    <MapPin className="w-3 h-3" /> Location
                  </button>
                </div>
                <button
                  type="button"
                  className="h-8 px-4 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={!nameInput.trim() || saving}
                  onClick={handleConfirmExtraction}
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                </button>
                <button
                  type="button"
                  className="h-8 px-3 text-xs rounded-md border hover:bg-muted"
                  onClick={handleCancelPending}
                >
                  Cancel
                </button>
              </div>
              {error && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-500">
                  <AlertTriangle className="w-3 h-3" /> {error}
                </div>
              )}
            </div>
          )}

          {/* Extracted references */}
          {characters.length > 0 && (
            <div className="mt-4">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Characters</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {characters.map((ref) => (
                  <div key={ref.id} className="flex items-center gap-2 p-1.5 pr-2 rounded-lg border bg-muted/30">
                    <img src={ref.imageUrl} alt={ref.name} className="w-10 h-10 rounded object-cover" />
                    <span className="text-xs font-medium">{ref.name}</span>
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-muted"
                      onClick={() => handleDeleteReference(ref.id)}
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {locations.length > 0 && (
            <div className="mt-3">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Locations</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {locations.map((ref) => (
                  <div key={ref.id} className="flex items-center gap-2 p-1.5 pr-2 rounded-lg border bg-muted/30">
                    <img src={ref.imageUrl} alt={ref.name} className="w-10 h-10 rounded object-cover" />
                    <span className="text-xs font-medium">{ref.name}</span>
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-muted"
                      onClick={() => handleDeleteReference(ref.id)}
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t">
          <span className="text-xs text-muted-foreground">
            {references.length} reference{references.length !== 1 ? "s" : ""} extracted
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 px-4 text-xs rounded-md border hover:bg-muted"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-8 px-4 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSave}
            >
              Save References
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
