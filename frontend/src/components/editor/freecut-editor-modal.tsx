"use client"

import { useEffect, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Upload } from "lucide-react"

const FREECUT_URL = import.meta.env.VITE_FREECUT_URL || "http://localhost:5174"
const FREECUT_ORIGIN = new URL(FREECUT_URL).origin

interface FreeCutEditorModalProps {
  readonly videoUrl: string
  readonly onExportComplete: (videoBlob: Blob) => void
  readonly onClose: () => void
}

export function FreeCutEditorModal({ videoUrl, onExportComplete, onClose }: FreeCutEditorModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const sentVideoRef = useRef(false)

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== FREECUT_ORIGIN) return

      if (event.data?.type === "FREECUT_READY") {
        // FreeCut message handler is initialized — send the video
        if (!sentVideoRef.current) {
          sentVideoRef.current = true
          const iframe = iframeRef.current
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(
              { type: "NODARO_LOAD_VIDEO", payload: { videoUrl } },
              FREECUT_ORIGIN,
            )
          }
        }
      }

      if (event.data?.type === "FREECUT_EXPORT_COMPLETE") {
        const buffer: ArrayBuffer = event.data.payload?.videoBuffer
        if (!buffer) return
        setUploading(true)
        const blob = new Blob([buffer], { type: "video/mp4" })
        onExportComplete(blob)
      }
    },
    [onExportComplete, videoUrl],
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setShowCloseConfirm(true)
      }
    },
    [],
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  function handleCancel() {
    setShowCloseConfirm(false)
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1E1E1E] border-b border-[#2D2D2D] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">FreeCut Editor</span>
          {uploading && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <Upload className="w-3 h-3 animate-pulse" />
              Uploading edited video...
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close editor"
          className="text-white/70 hover:text-white transition-colors"
          onClick={() => setShowCloseConfirm(true)}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="w-8 h-8 animate-spin text-white/50" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={FREECUT_URL}
          className="w-full h-full border-0"
          allow="autoplay; camera; microphone; storage-access"
          onLoad={() => setIframeLoaded(true)}
          title="FreeCut Video Editor"
        />
      </div>

      {/* Close confirmation */}
      {showCloseConfirm && (
        <div className="absolute inset-0 z-[10000] bg-black/60 flex items-center justify-center">
          <div className="bg-[#1E1E1E] border border-[#2D2D2D] rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-sm font-medium text-white mb-2">Close editor?</h3>
            <p className="text-xs text-white/60 mb-4">
              Any unsaved edits will be lost. The node will stay paused so you can reopen the editor.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setShowCloseConfirm(false)}
              >
                Keep Editing
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                onClick={handleCancel}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
