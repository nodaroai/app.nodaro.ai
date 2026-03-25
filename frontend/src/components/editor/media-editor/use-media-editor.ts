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
        const dw = editorState.displayWidth
        const dh = editorState.displayHeight
        // Crop is "edited" if it doesn't cover the full display image
        const cropEdited = crop && dw > 0 && dh > 0 && (
          crop.x > 1 || crop.y > 1 ||
          crop.width < dw - 2 || crop.height < dh - 2
        )

        if (cropEdited && crop && dw > 0) {
          const blob = await cropImageCanvas(
            currentFile.objectUrl,
            { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
            currentFile.naturalWidth,
            currentFile.naturalHeight,
            dw,
            dh,
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
        const dw = editorState.displayWidth
        const dh = editorState.displayHeight
        const { crop } = editorState
        const cropEdited = crop && dw > 0 && dh > 0 && (
          crop.x > 1 || crop.y > 1 ||
          crop.width < dw - 2 || crop.height < dh - 2
        )
        const hasEdits = cropEdited || editorState.trim || editorState.format

        if (hasEdits) {
          const processParams: Parameters<typeof processMedia>[0] = {
            sourceUrl: uploadResult.url,
            type: currentFile.mediaType as "video" | "audio",
          }
          if (cropEdited && crop && currentFile.mediaType === "video") {
            const scaleX = currentFile.naturalWidth / dw
            const scaleY = currentFile.naturalHeight / dh
            processParams.crop = {
              x: Math.round(crop.x * scaleX),
              y: Math.round(crop.y * scaleY),
              width: Math.round(crop.width * scaleX),
              height: Math.round(crop.height * scaleY),
            }
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
    } catch (err) {
      console.error("[media-editor] Upload failed:", err)
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
          const { crop: applyCrop } = editorState
          const adw = editorState.displayWidth
          const adh = editorState.displayHeight
          const applyCropEdited = applyCrop && adw > 0 && adh > 0 && (
            applyCrop.x > 1 || applyCrop.y > 1 ||
            applyCrop.width < adw - 2 || applyCrop.height < adh - 2
          )
          const hasEdits = applyCropEdited || editorState.trim || editorState.format
          if (hasEdits) {
            const processParams: Parameters<typeof processMedia>[0] = {
              sourceUrl: uploadResult.url,
              type: file.mediaType as "video" | "audio",
            }
            if (applyCropEdited && applyCrop && file.mediaType === "video") {
              const scaleX = file.naturalWidth / adw
              const scaleY = file.naturalHeight / adh
              processParams.crop = {
                x: Math.round(applyCrop.x * scaleX),
                y: Math.round(applyCrop.y * scaleY),
                width: Math.round(applyCrop.width * scaleX),
                height: Math.round(applyCrop.height * scaleY),
              }
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
    } catch (err) {
      console.error("[media-editor] Apply all failed:", err)
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
