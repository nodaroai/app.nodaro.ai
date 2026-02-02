"use client"

import { useEffect, useCallback, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Scissors, User, MapPin, Loader2, AlertTriangle } from "lucide-react"
import { cropImageToBlob } from "@/lib/image-utils"
import { uploadImage } from "@/lib/api"
import type { ExtractedReference } from "@/types/nodes"

interface DrawRect {
  startX: number
  startY: number
  endX: number
  endY: number
}

interface PendingExtraction {
  rect: DrawRect
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
}

export function ExtractReferencesModal({
  isOpen,
  onClose,
  imageUrl,
  sceneIndex,
  sceneCharacters,
  existingReferences,
  onSave,
}: ExtractReferencesModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [imageLoaded, setImageLoaded] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [currentRect, setCurrentRect] = useState<DrawRect | null>(null)
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
      setError(null)
      setImageLoaded(false)
    }
  }, [isOpen, existingReferences])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (pending) {
        setPending(null)
        setCurrentRect(null)
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

  // Load image and draw on canvas
  useEffect(() => {
    if (!isOpen || !imageUrl) return
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      imgRef.current = img
      setImageLoaded(true)
      drawCanvas(img, null)
    }
    img.src = imageUrl
  }, [isOpen, imageUrl])

  function getCanvasScale(): { scaleX: number; scaleY: number } {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return { scaleX: 1, scaleY: 1 }
    return {
      scaleX: img.naturalWidth / canvas.clientWidth,
      scaleY: img.naturalHeight / canvas.clientHeight,
    }
  }

  function drawCanvas(img: HTMLImageElement, rect: DrawRect | null) {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = containerRef.current
    if (!container) return

    const maxW = container.clientWidth
    const maxH = Math.min(container.clientHeight - 200, 500)
    const aspect = img.naturalWidth / img.naturalHeight
    let w = maxW
    let h = w / aspect
    if (h > maxH) {
      h = maxH
      w = h * aspect
    }

    canvas.width = w
    canvas.height = h
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(img, 0, 0, w, h)

    // Draw existing reference boxes
    for (const ref of references) {
      if (ref.sourceSceneIndex === sceneIndex) {
        const { scaleX, scaleY } = getCanvasScale()
        const x = ref.boundingBox.x / scaleX
        const y = ref.boundingBox.y / scaleY
        const bw = ref.boundingBox.width / scaleX
        const bh = ref.boundingBox.height / scaleY
        ctx.strokeStyle = ref.type === "character" ? "#a855f7" : "#3b82f6"
        ctx.lineWidth = 2
        ctx.setLineDash([])
        ctx.strokeRect(x, y, bw, bh)
        ctx.fillStyle = ref.type === "character" ? "#a855f7" : "#3b82f6"
        ctx.font = "11px sans-serif"
        ctx.fillText(ref.name, x + 3, y - 4)
      }
    }

    // Draw current selection
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
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (pending) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDrawing(true)
    setCurrentRect({ startX: x, startY: y, endX: x, endY: y })
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing || !currentRect) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const newRect = { ...currentRect, endX: x, endY: y }
    setCurrentRect(newRect)
    if (imgRef.current) drawCanvas(imgRef.current, newRect)
  }

  function handleMouseUp() {
    if (!drawing || !currentRect) return
    setDrawing(false)

    const w = Math.abs(currentRect.endX - currentRect.startX)
    const h = Math.abs(currentRect.endY - currentRect.startY)

    if (w < 20 || h < 20) {
      setCurrentRect(null)
      if (imgRef.current) drawCanvas(imgRef.current, null)
      return
    }

    // Suggest a name from scene characters that aren't already extracted
    const existingNames = new Set(references.map((r) => r.name))
    const suggestion = sceneCharacters.find((c) => !existingNames.has(c)) ?? ""

    setPending({
      rect: currentRect,
      name: suggestion,
      type: "character",
    })
    setNameInput(suggestion)
    setTypeInput("character")
  }

  async function handleConfirmExtraction() {
    if (!pending || !nameInput.trim()) return
    setError(null)
    setSaving(true)

    try {
      const { scaleX, scaleY } = getCanvasScale()
      const x = Math.min(pending.rect.startX, pending.rect.endX) * scaleX
      const y = Math.min(pending.rect.startY, pending.rect.endY) * scaleY
      const w = Math.abs(pending.rect.endX - pending.rect.startX) * scaleX
      const h = Math.abs(pending.rect.endY - pending.rect.startY) * scaleY

      if (w < 64 || h < 64) {
        setError("Selection too small. Minimum 64x64 pixels recommended for good reference quality.")
        setSaving(false)
        return
      }

      const blob = await cropImageToBlob(imageUrl, { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) })
      const { url } = await uploadImage(blob)

      const newRef: ExtractedReference = {
        id: crypto.randomUUID(),
        name: nameInput.trim(),
        type: typeInput,
        imageUrl: url,
        sourceSceneIndex: sceneIndex,
        boundingBox: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) },
      }

      setReferences([...references, newRef])
      setPending(null)
      setCurrentRect(null)
      if (imgRef.current) drawCanvas(imgRef.current, null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract reference")
    } finally {
      setSaving(false)
    }
  }

  function handleDeleteReference(id: string) {
    const updated = references.filter((r) => r.id !== id)
    setReferences(updated)
    if (imgRef.current) {
      // Redraw after removing a reference
      setTimeout(() => {
        if (imgRef.current) drawCanvas(imgRef.current, null)
      }, 0)
    }
  }

  function handleSave() {
    onSave(references)
    onClose()
  }

  // Redraw when references change
  useEffect(() => {
    if (imageLoaded && imgRef.current) {
      drawCanvas(imgRef.current, currentRect)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references, imageLoaded])

  if (!isOpen) return null

  const characters = references.filter((r) => r.type === "character")
  const locations = references.filter((r) => r.type === "location")

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={containerRef}
        className="relative w-[90vw] max-w-3xl max-h-[90vh] bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <Scissors className="w-4 h-4 text-purple-500" />
            <h2 className="text-sm font-semibold">Extract References from Scene {sceneIndex + 1}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto p-4">
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              className={`rounded-md border ${pending ? "cursor-not-allowed opacity-75" : "cursor-crosshair"}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => { if (drawing) handleMouseUp() }}
            />
          </div>

          {!pending && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              Click and drag on the image to select a character or location
            </p>
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
                  onClick={() => { setPending(null); setCurrentRect(null); if (imgRef.current) drawCanvas(imgRef.current, null) }}
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
