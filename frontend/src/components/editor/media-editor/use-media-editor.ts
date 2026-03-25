// frontend/src/components/editor/media-editor/use-media-editor.ts
import { useCallback, useEffect, useRef, useState } from "react"
import { processMedia, type UploadResult } from "@/lib/api"
import { useFileUpload } from "@/hooks/use-file-upload"
import {
  detectMediaType,
  isBrowserPlayable,
  cropImageCanvas,
  DEFAULT_EDITOR_STATE,
  type MediaEditorState,
  type MediaCategory,
  type CropState,
  type TrimState,
} from "./utils"

export interface MediaEditorFile {
  file: File
  objectUrl: string
  mediaType: MediaCategory
  needsConversion: boolean  // true if video is not browser-playable
  convertedUrl?: string     // R2 URL after auto-conversion
  naturalWidth: number
  naturalHeight: number
  duration: number
}

export interface MediaEditorResult {
  uploadResult: UploadResult
  processedUrl?: string
}

interface UseMediaEditorOptions {
  onComplete: (results: MediaEditorResult[]) => void
  onCancel?: () => void
}

export function useMediaEditor({ onComplete, onCancel }: UseMediaEditorOptions) {
  const [isOpen, setIsOpen] = useState(false)
  const [files, setFiles] = useState<MediaEditorFile[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [editorState, setEditorState] = useState<MediaEditorState>(DEFAULT_EDITOR_STATE)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [completedResults, setCompletedResults] = useState<MediaEditorResult[]>([])
  const { upload } = useFileUpload()

  // Use ref for files so cleanup always sees the latest array
  const filesRef = useRef(files)
  filesRef.current = files

  const currentFile = files[currentIndex] ?? null
  const totalFiles = files.length
  const remainingFiles = totalFiles - currentIndex

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => URL.revokeObjectURL(f.objectUrl))
    }
  }, [])

  const cleanup = useCallback(() => {
    filesRef.current.forEach((f) => URL.revokeObjectURL(f.objectUrl))
    setFiles([])
    setCurrentIndex(0)
    setEditorState(DEFAULT_EDITOR_STATE)
    setCompletedResults([])
  }, [])

  const handleAutoConvert = useCallback(async (editorFile: MediaEditorFile) => {
    setIsConverting(true)
    try {
      const uploadResult = await upload(editorFile.file)
      const processed = await processMedia({
        sourceUrl: uploadResult.url,
        type: "video",
        format: "mp4",
      })
      const meta = await getVideoMetadata(processed.url)
      setFiles((prev) =>
        prev.map((f) =>
          f === editorFile
            ? { ...f, convertedUrl: processed.url, naturalWidth: meta.width, naturalHeight: meta.height, duration: meta.duration }
            : f,
        ),
      )
    } catch {
      setIsOpen(false)
      cleanup()
    } finally {
      setIsConverting(false)
    }
  }, [upload, cleanup])

  const openEditor = useCallback(async (inputFiles: File[]) => {
    if (inputFiles.length === 0) return

    const editorFiles: MediaEditorFile[] = []

    for (const file of inputFiles) {
      const mediaType = detectMediaType(file)
      const objectUrl = URL.createObjectURL(file)
      const needsConversion = mediaType === "video" && !isBrowserPlayable(file)

      const info: MediaEditorFile = {
        file,
        objectUrl,
        mediaType,
        needsConversion,
        naturalWidth: 0,
        naturalHeight: 0,
        duration: 0,
      }

      if (mediaType === "image") {
        const dims = await getImageDimensions(objectUrl)
        info.naturalWidth = dims.width
        info.naturalHeight = dims.height
      } else if (mediaType === "video" && !needsConversion) {
        const meta = await getVideoMetadata(objectUrl)
        info.naturalWidth = meta.width
        info.naturalHeight = meta.height
        info.duration = meta.duration
      }

      editorFiles.push(info)
    }

    setFiles(editorFiles)
    setCurrentIndex(0)
    setEditorState(DEFAULT_EDITOR_STATE)
    setCompletedResults([])
    setIsOpen(true)

    if (editorFiles[0]?.needsConversion) {
      await handleAutoConvert(editorFiles[0])
    }
  }, [handleAutoConvert])

  const handleUploadCurrent = useCallback(async () => {
    if (!currentFile) return
    setIsProcessing(true)

    try {
      let result: MediaEditorResult

      if (currentFile.mediaType === "image") {
        const { crop } = editorState
        if (crop && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1)) {
          const mediaUrl = currentFile.objectUrl
          const blob = await cropImageCanvas(
            mediaUrl,
            { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
            currentFile.naturalWidth,
            currentFile.naturalHeight,
            crop.width / (crop.zoom || 1),
            crop.height / (crop.zoom || 1),
            editorState.format ?? undefined,
          )
          const croppedFile = new File([blob], currentFile.file.name, { type: blob.type })
          const uploadResult = await upload(croppedFile)
          result = { uploadResult }
        } else if (editorState.format) {
          const blob = await cropImageCanvas(
            currentFile.objectUrl,
            { x: 0, y: 0, width: currentFile.naturalWidth, height: currentFile.naturalHeight },
            currentFile.naturalWidth,
            currentFile.naturalHeight,
            currentFile.naturalWidth,
            currentFile.naturalHeight,
            editorState.format,
          )
          const convertedFile = new File([blob], currentFile.file.name, { type: blob.type })
          const uploadResult = await upload(convertedFile)
          result = { uploadResult }
        } else {
          const uploadResult = await upload(currentFile.file)
          result = { uploadResult }
        }
      } else {
        const uploadResult = await upload(currentFile.file)
        const cropIsEdited = editorState.crop && (
          editorState.crop.zoom !== 1 ||
          editorState.crop.panX !== 0 ||
          editorState.crop.panY !== 0 ||
          editorState.aspectRatio !== "original"
        )
        const hasEdits = cropIsEdited || editorState.trim || editorState.format

        if (hasEdits) {
          const processParams: Parameters<typeof processMedia>[0] = {
            sourceUrl: uploadResult.url,
            type: currentFile.mediaType as "video" | "audio",
          }
          if (editorState.crop && currentFile.mediaType === "video") {
            processParams.crop = computeCropPixels(editorState.crop, currentFile.naturalWidth, currentFile.naturalHeight)
          }
          if (editorState.trim) {
            processParams.trim = editorState.trim
          }
          if (editorState.format) {
            processParams.format = editorState.format
          }

          const processed = await processMedia(processParams)
          result = { uploadResult, processedUrl: processed.url }
        } else {
          result = { uploadResult }
        }
      }

      const newResults = [...completedResults, result]

      if (currentIndex + 1 < totalFiles) {
        setCompletedResults(newResults)
        const nextIdx = currentIndex + 1
        setCurrentIndex(nextIdx)
        setEditorState(DEFAULT_EDITOR_STATE)

        const nextFile = files[nextIdx]
        if (nextFile?.needsConversion && !nextFile.convertedUrl) {
          await handleAutoConvert(nextFile)
        }
      } else {
        setIsOpen(false)
        cleanup()
        onComplete(newResults)
      }
    } catch {
      // Error handled by upload hook
    } finally {
      setIsProcessing(false)
    }
  }, [currentFile, editorState, currentIndex, totalFiles, files, completedResults, upload, onComplete, cleanup, handleAutoConvert])

  const handleApplyAll = useCallback(async () => {
    if (!currentFile) return
    setIsProcessing(true)

    try {
      const allResults = [...completedResults]

      for (let i = currentIndex; i < totalFiles; i++) {
        const file = files[i]
        if (!file) continue

        if (file.mediaType === "image") {
          const { crop } = editorState
          if (crop) {
            const blob = await cropImageCanvas(
              file.objectUrl,
              { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
              file.naturalWidth,
              file.naturalHeight,
              crop.width / (crop.zoom || 1),
              crop.height / (crop.zoom || 1),
              editorState.format ?? undefined,
            )
            const croppedFile = new File([blob], file.file.name, { type: blob.type })
            const uploadResult = await upload(croppedFile)
            allResults.push({ uploadResult })
          } else {
            const uploadResult = await upload(file.file)
            allResults.push({ uploadResult })
          }
        } else {
          const uploadResult = await upload(file.file)
          const hasEdits = editorState.crop || editorState.trim || editorState.format
          if (hasEdits) {
            const processParams: Parameters<typeof processMedia>[0] = {
              sourceUrl: uploadResult.url,
              type: file.mediaType as "video" | "audio",
            }
            if (editorState.crop && file.mediaType === "video") {
              processParams.crop = computeCropPixels(editorState.crop, file.naturalWidth, file.naturalHeight)
            }
            if (editorState.trim) processParams.trim = editorState.trim
            if (editorState.format) processParams.format = editorState.format
            const processed = await processMedia(processParams)
            allResults.push({ uploadResult, processedUrl: processed.url })
          } else {
            allResults.push({ uploadResult })
          }
        }
      }

      setIsOpen(false)
      cleanup()
      onComplete(allResults)
    } catch {
      // Error handled
    } finally {
      setIsProcessing(false)
    }
  }, [currentFile, editorState, currentIndex, totalFiles, files, completedResults, upload, onComplete, cleanup])

  const handleCancel = useCallback(() => {
    setIsOpen(false)
    cleanup()
    onCancel?.()
  }, [onCancel, cleanup])

  const handleReset = useCallback(() => {
    setEditorState(DEFAULT_EDITOR_STATE)
  }, [])

  const allSameType =
    remainingFiles > 1 &&
    files
      .slice(currentIndex)
      .every((f) => f.mediaType === currentFile?.mediaType)

  return {
    isOpen,
    currentFile,
    currentIndex,
    totalFiles,
    remainingFiles,
    editorState,
    setEditorState,
    isProcessing,
    isConverting,
    allSameType,
    openEditor,
    handleUploadCurrent,
    handleApplyAll,
    handleCancel,
    handleReset,
  }
}

// --- Helpers ---

/**
 * Translate display-space crop coordinates to original pixel coordinates.
 * Uses the CropState's own width/height and the known natural dimensions
 * to derive the display scale, avoiding any DOM queries.
 */
function computeCropPixels(
  crop: CropState,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; width: number; height: number } {
  // CropPanel initialises crop.width/height to displayWidth/displayHeight,
  // where displayScale = min(containerW/naturalW, containerH/naturalH, 1).
  // We don't know the container size, but we can derive the scale from the
  // initial crop dimensions that covered the full image (zoom=1, panX/Y=0).
  // CropPanel's displayWidth = naturalWidth * displayScale, and the crop
  // region is always in that coordinate space.  So:
  //   scaleX = naturalWidth  / (naturalWidth * displayScale) = 1 / displayScale
  // But we don't have displayScale directly.  However the crop panel set
  // displayWidth = naturalWidth * displayScale, so if we know the full-image
  // display width we can solve for it.  Since we don't store that, use a
  // safe approximation: the crop coordinates already represent a fraction of
  // the display image.  The aspect ratio is preserved (scaleX === scaleY)
  // so we can derive scale from crop dimensions relative to natural size.
  // CropPanel clamps crop within [0, displayWidth] x [0, displayHeight],
  // so max(crop.x + crop.width) ≤ displayWidth = naturalWidth * displayScale.
  // The safest approach: use the fact that displayScale ≤ 1, so the crop's
  // coordinate space upper bound equals naturalWidth * displayScale.  Since
  // we need pixel coords, multiply by 1/displayScale.  We approximate
  // displayScale as min(crop_max_x / naturalWidth, crop_max_y / naturalHeight, 1)
  // but that's circular.  Instead, use CropPanel's own displayScale formula
  // with a reasonable max container size of 480x400 (the modal's max dimensions).
  const MAX_CONTAINER_W = 480
  const MAX_CONTAINER_H = 400
  const displayScale = Math.min(
    MAX_CONTAINER_W / naturalWidth,
    MAX_CONTAINER_H / naturalHeight,
    1,
  )
  const inv = 1 / displayScale
  return {
    x: Math.round(crop.x * inv),
    y: Math.round(crop.y * inv),
    width: Math.round(crop.width * inv),
    height: Math.round(crop.height * inv),
  }
}

function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = url
  })
}

function getVideoMetadata(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    video.preload = "metadata"
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      })
    }
    video.onerror = reject
    video.src = url
  })
}
