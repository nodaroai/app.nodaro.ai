// frontend/src/components/editor/media-editor/crop-panel.tsx
import { useCallback, useEffect, useRef, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { parseAspectRatio, type CropState } from "./utils"

interface CropPanelProps {
  mediaUrl: string
  mediaType: "image" | "video"
  naturalWidth: number
  naturalHeight: number
  aspectRatio: string
  crop: CropState | null
  onCropChange: (crop: CropState) => void
  videoRef?: React.RefObject<HTMLVideoElement | null>
}

const MIN_CROP_SIZE = 20
const HANDLE_SIZE = 12

type DragType = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | "pan" | null

export function CropPanel({
  mediaUrl,
  mediaType,
  naturalWidth,
  naturalHeight,
  aspectRatio,
  crop,
  onCropChange,
  videoRef,
}: CropPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [dragType, setDragType] = useState<DragType>(null)
  const dragStartRef = useRef<{ x: number; y: number; crop: CropState } | null>(null)

  // Guard against zero natural dimensions (prevents division by zero)
  if (!naturalWidth || !naturalHeight) return null

  // Calculate display dimensions (fit media in container)
  const displayScale = Math.min(
    containerSize.width / naturalWidth,
    containerSize.height / naturalHeight,
    1,
  )
  const displayWidth = naturalWidth * displayScale
  const displayHeight = naturalHeight * displayScale

  // Observe container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Initialize crop to full image when not set
  useEffect(() => {
    if (!crop && displayWidth > 0 && displayHeight > 0) {
      onCropChange({
        x: 0,
        y: 0,
        width: displayWidth,
        height: displayHeight,
        zoom: 1,
        panX: 0,
        panY: 0,
      })
    }
  }, [crop, displayWidth, displayHeight, onCropChange])

  const lockedRatio = parseAspectRatio(aspectRatio)

  const constrainCrop = useCallback(
    (c: CropState): CropState => {
      let { x, y, width, height, zoom, panX, panY } = c
      // Enforce aspect ratio
      if (lockedRatio !== null) {
        const currentRatio = width / height
        if (currentRatio > lockedRatio) {
          width = height * lockedRatio
        } else {
          height = width / lockedRatio
        }
      }
      // Enforce minimum size
      width = Math.max(width, MIN_CROP_SIZE)
      height = Math.max(height, MIN_CROP_SIZE)
      // Keep within display bounds
      x = Math.max(0, Math.min(x, displayWidth - width))
      y = Math.max(0, Math.min(y, displayHeight - height))
      return { x, y, width, height, zoom, panX, panY }
    },
    [lockedRatio, displayWidth, displayHeight],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: DragType) => {
      e.preventDefault()
      e.stopPropagation()
      if (!crop) return
      setDragType(type)
      dragStartRef.current = { x: e.clientX, y: e.clientY, crop: { ...crop } }
    },
    [crop],
  )

  useEffect(() => {
    if (!dragType || !dragStartRef.current || !crop) return

    const handleMouseMove = (e: MouseEvent) => {
      const start = dragStartRef.current!
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      const sc = start.crop

      let newCrop: CropState

      if (dragType === "move") {
        newCrop = { ...sc, x: sc.x + dx, y: sc.y + dy }
      } else if (dragType === "pan") {
        newCrop = { ...sc, panX: sc.panX + dx, panY: sc.panY + dy }
      } else {
        // Resize handles
        let nx = sc.x, ny = sc.y, nw = sc.width, nh = sc.height
        if (dragType.includes("e")) nw = sc.width + dx
        if (dragType.includes("w")) { nx = sc.x + dx; nw = sc.width - dx }
        if (dragType.includes("s")) nh = sc.height + dy
        if (dragType.includes("n")) { ny = sc.y + dy; nh = sc.height - dy }
        newCrop = { ...sc, x: nx, y: ny, width: nw, height: nh }
      }

      onCropChange(constrainCrop(newCrop))
    }

    const handleMouseUp = () => {
      setDragType(null)
      dragStartRef.current = null
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [dragType, crop, onCropChange, constrainCrop])

  const handleZoomChange = useCallback(
    (newZoom: number) => {
      if (!crop) return
      const clampedZoom = Math.max(1, Math.min(newZoom, 5))
      onCropChange({ ...crop, zoom: clampedZoom })
    },
    [crop, onCropChange],
  )

  if (!crop) return null

  const renderHandles = () => {
    const positions: { type: DragType; style: React.CSSProperties; cursor: string }[] = [
      { type: "nw", style: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }, cursor: "nw-resize" },
      { type: "ne", style: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }, cursor: "ne-resize" },
      { type: "sw", style: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }, cursor: "sw-resize" },
      { type: "se", style: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }, cursor: "se-resize" },
      { type: "n", style: { top: -HANDLE_SIZE / 2, left: "50%", marginLeft: -HANDLE_SIZE / 2 }, cursor: "n-resize" },
      { type: "s", style: { bottom: -HANDLE_SIZE / 2, left: "50%", marginLeft: -HANDLE_SIZE / 2 }, cursor: "s-resize" },
      { type: "e", style: { top: "50%", right: -HANDLE_SIZE / 2, marginTop: -HANDLE_SIZE / 2 }, cursor: "e-resize" },
      { type: "w", style: { top: "50%", left: -HANDLE_SIZE / 2, marginTop: -HANDLE_SIZE / 2 }, cursor: "w-resize" },
    ]

    return positions.map(({ type, style, cursor }) => (
      <div
        key={type}
        className="absolute w-3 h-3 bg-white border-2 border-[#ff0073] rounded-sm z-10"
        style={{ ...style, cursor }}
        onMouseDown={(e) => handleMouseDown(e, type)}
      />
    ))
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Preview area */}
      <div
        ref={containerRef}
        data-crop-container
        className="relative bg-black/80 rounded-lg overflow-hidden select-none"
        style={{ minHeight: 200, maxHeight: 400 }}
        onMouseDown={(e) => handleMouseDown(e, "pan")}
      >
        {/* Media element */}
        <div
          className="absolute"
          style={{
            left: "50%",
            top: "50%",
            transform: `translate(-50%, -50%) scale(${crop.zoom}) translate(${crop.panX / crop.zoom}px, ${crop.panY / crop.zoom}px)`,
          }}
        >
          {mediaType === "image" ? (
            <img
              src={mediaUrl}
              alt="Preview"
              style={{ width: displayWidth, height: displayHeight }}
              draggable={false}
            />
          ) : (
            <video
              ref={videoRef}
              src={mediaUrl}
              style={{ width: displayWidth, height: displayHeight }}
              muted
            />
          )}

          {/* Dark overlay outside crop */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Top */}
            <div
              className="absolute bg-black/60"
              style={{ top: 0, left: 0, right: 0, height: crop.y }}
            />
            {/* Bottom */}
            <div
              className="absolute bg-black/60"
              style={{ top: crop.y + crop.height, left: 0, right: 0, bottom: 0 }}
            />
            {/* Left */}
            <div
              className="absolute bg-black/60"
              style={{ top: crop.y, left: 0, width: crop.x, height: crop.height }}
            />
            {/* Right */}
            <div
              className="absolute bg-black/60"
              style={{ top: crop.y, left: crop.x + crop.width, right: 0, height: crop.height }}
            />
          </div>

          {/* Crop box */}
          <div
            className="absolute border-2 border-white/80"
            style={{
              left: crop.x,
              top: crop.y,
              width: crop.width,
              height: crop.height,
              cursor: "move",
            }}
            onMouseDown={(e) => handleMouseDown(e, "move")}
          >
            {/* Rule of thirds grid */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
              <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
              <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
              <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
            </div>
            {renderHandles()}
          </div>
        </div>
      </div>

      {/* Zoom slider */}
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => handleZoomChange(crop.zoom - 0.25)}
          className="p-1 text-muted-foreground hover:text-white transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <input
          type="range"
          min={1}
          max={5}
          step={0.1}
          value={crop.zoom}
          onChange={(e) => handleZoomChange(Number(e.target.value))}
          className="flex-1 accent-[#ff0073]"
        />
        <button
          type="button"
          onClick={() => handleZoomChange(crop.zoom + 0.25)}
          className="p-1 text-muted-foreground hover:text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
