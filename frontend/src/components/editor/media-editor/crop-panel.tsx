import { useCallback, useEffect, useRef, useState } from "react"
import { parseAspectRatio, type CropState } from "./utils"

interface CropPanelProps {
  mediaUrl: string
  mediaType: "image" | "video"
  naturalWidth: number
  naturalHeight: number
  aspectRatio: string
  crop: CropState | null
  onCropChange: (crop: CropState) => void
  onDisplaySizeChange?: (w: number, h: number) => void
  onAspectRatioChange?: (ratio: string) => void
  videoRef?: React.RefObject<HTMLVideoElement | null>
}

const MIN_CROP_SIZE = 20
const HANDLE_SIZE = 12

type DragType = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | null

export function CropPanel({
  mediaUrl,
  mediaType,
  naturalWidth,
  naturalHeight,
  aspectRatio,
  crop,
  onCropChange,
  onDisplaySizeChange,
  onAspectRatioChange,
  videoRef,
}: CropPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [dragType, setDragType] = useState<DragType>(null)
  const dragStartRef = useRef<{ x: number; y: number; crop: CropState } | null>(null)

  if (!naturalWidth || !naturalHeight) return null

  // Once the image renders, measure its actual on-screen size
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setImgSize({ w: img.clientWidth, h: img.clientHeight })
    onDisplaySizeChange?.(img.clientWidth, img.clientHeight)
  }, [onDisplaySizeChange])

  const handleVideoLoad = useCallback(() => {
    if (videoRef?.current) {
      const w = videoRef.current.clientWidth
      const h = videoRef.current.clientHeight
      setImgSize({ w, h })
      onDisplaySizeChange?.(w, h)
    }
  }, [videoRef, onDisplaySizeChange])

  // Init crop to full displayed image once we know the size
  useEffect(() => {
    if (!crop && imgSize.w > 0 && imgSize.h > 0) {
      onCropChange({ x: 0, y: 0, width: imgSize.w, height: imgSize.h, zoom: 1, panX: 0, panY: 0 })
    }
  }, [crop, imgSize.w, imgSize.h, onCropChange])

  // When aspect ratio changes, re-constrain existing crop
  const lockedRatio = parseAspectRatio(aspectRatio)
  // "original" means the natural image ratio, not "no constraint"
  const effectiveRatio = aspectRatio === "original" ? naturalWidth / naturalHeight : lockedRatio
  useEffect(() => {
    if (crop && imgSize.w > 0 && effectiveRatio !== null) {
      let { x, y, width, height } = crop
      const currentRatio = width / height
      if (Math.abs(currentRatio - effectiveRatio) > 0.02) {
        if (currentRatio > effectiveRatio) {
          width = height * effectiveRatio
        } else {
          height = width / effectiveRatio
        }
        width = Math.max(MIN_CROP_SIZE, Math.min(width, imgSize.w))
        height = Math.max(MIN_CROP_SIZE, Math.min(height, imgSize.h))
        x = Math.max(0, Math.min(x, imgSize.w - width))
        y = Math.max(0, Math.min(y, imgSize.h - height))
        onCropChange({ ...crop, x, y, width, height })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectRatio])

  function constrainCrop(c: CropState): CropState {
    let { x, y, width, height } = c
    const maxW = imgSize.w
    const maxH = imgSize.h
    if (maxW <= 0 || maxH <= 0) return c

    // Lock to ratio for all presets including "original" (but not "custom")
    if (effectiveRatio !== null && aspectRatio !== "custom") {
      if (width / height > effectiveRatio) {
        width = height * effectiveRatio
      } else {
        height = width / effectiveRatio
      }
    }
    width = Math.max(MIN_CROP_SIZE, Math.min(width, maxW))
    height = Math.max(MIN_CROP_SIZE, Math.min(height, maxH))
    x = Math.max(0, Math.min(x, maxW - width))
    y = Math.max(0, Math.min(y, maxH - height))
    return { ...c, x, y, width, height }
  }

  // --- Drag handling ---
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
      } else {
        let nx = sc.x, ny = sc.y, nw = sc.width, nh = sc.height
        if (dragType.includes("e")) nw = sc.width + dx
        if (dragType.includes("w")) { nx = sc.x + dx; nw = sc.width - dx }
        if (dragType.includes("s")) nh = sc.height + dy
        if (dragType.includes("n")) { ny = sc.y + dy; nh = sc.height - dy }
        newCrop = { ...sc, x: nx, y: ny, width: nw, height: nh }
      }
      const constrained = constrainCrop(newCrop)
      onCropChange(constrained)
      // If user resized (not moved) and ratio is unlocked, switch to "custom"
      if (dragType !== "move" && lockedRatio === null && onAspectRatioChange) {
        const newRatio = constrained.width / constrained.height
        const isOriginalRatio = Math.abs(newRatio - naturalWidth / naturalHeight) < 0.02
        if (!isOriginalRatio && constrained.width < imgSize.w * 0.99) {
          onAspectRatioChange("custom")
        }
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragType, crop])

  const handles: { type: DragType; style: React.CSSProperties; cursor: string }[] = [
    { type: "nw", style: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }, cursor: "nw-resize" },
    { type: "ne", style: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }, cursor: "ne-resize" },
    { type: "sw", style: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }, cursor: "sw-resize" },
    { type: "se", style: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }, cursor: "se-resize" },
    { type: "n", style: { top: -HANDLE_SIZE / 2, left: "50%", marginLeft: -HANDLE_SIZE / 2 }, cursor: "n-resize" },
    { type: "s", style: { bottom: -HANDLE_SIZE / 2, left: "50%", marginLeft: -HANDLE_SIZE / 2 }, cursor: "s-resize" },
    { type: "e", style: { top: "50%", right: -HANDLE_SIZE / 2, marginTop: -HANDLE_SIZE / 2 }, cursor: "e-resize" },
    { type: "w", style: { top: "50%", left: -HANDLE_SIZE / 2, marginTop: -HANDLE_SIZE / 2 }, cursor: "w-resize" },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* Image container — the image drives the container size naturally */}
      <div
        ref={wrapperRef}
        className="relative mx-auto select-none rounded-lg overflow-hidden bg-black"
        style={{ maxWidth: "100%", maxHeight: "60vh" }}
      >
        {/* The actual media element — displayed inline so it sizes the container */}
        {mediaType === "image" ? (
          <img
            src={mediaUrl}
            alt="Preview"
            draggable={false}
            onLoad={handleImageLoad}
            className="block max-w-full max-h-[60vh] mx-auto"
          />
        ) : (
          <video
            ref={videoRef}
            src={mediaUrl}
            muted
            onLoadedMetadata={handleVideoLoad}
            className="block max-w-full max-h-[60vh] mx-auto"
          />
        )}

        {/* Crop overlay — positioned absolute over the image */}
        {crop && imgSize.w > 0 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ width: imgSize.w, height: imgSize.h, left: "50%", top: 0, transform: "translateX(-50%)" }}
          >
            {/* Dark overlay outside crop (4 rects) */}
            <div className="absolute bg-black/60" style={{ top: 0, left: 0, right: 0, height: crop.y }} />
            <div className="absolute bg-black/60" style={{ top: crop.y + crop.height, left: 0, right: 0, bottom: 0 }} />
            <div className="absolute bg-black/60" style={{ top: crop.y, left: 0, width: crop.x, height: crop.height }} />
            <div className="absolute bg-black/60" style={{ top: crop.y, left: crop.x + crop.width, right: 0, height: crop.height }} />

            {/* Crop selection box */}
            <div
              className="absolute border-2 border-white/80 pointer-events-auto"
              style={{ left: crop.x, top: crop.y, width: crop.width, height: crop.height, cursor: "move" }}
              onMouseDown={(e) => handleMouseDown(e, "move")}
            >
              {/* Rule of thirds */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
              </div>
              {/* Resize handles */}
              {handles.map(({ type, style, cursor }) => (
                <div
                  key={type}
                  className="absolute w-3 h-3 bg-white border-2 border-[#ff0073] rounded-sm z-10 pointer-events-auto"
                  style={{ ...style, cursor }}
                  onMouseDown={(e) => handleMouseDown(e, type)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
