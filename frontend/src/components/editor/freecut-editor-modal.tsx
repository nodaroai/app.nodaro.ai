"use client"

import { useEffect, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Check, FilePlus } from "lucide-react"

const FREECUT_URL = import.meta.env.VITE_FREECUT_URL || "http://localhost:5174"
const FREECUT_ORIGIN = new URL(FREECUT_URL).origin

interface FreeCutEditorModalProps {
  readonly videoUrl: string
  readonly freecutProjectUrl?: string
  readonly onExportComplete: (videoBlob: Blob, projectJson?: unknown) => Promise<void>
  readonly onClose: () => void
}

export function FreeCutEditorModal({ videoUrl, freecutProjectUrl, onExportComplete, onClose }: FreeCutEditorModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done">("idle")
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [showNewProjectConfirm, setShowNewProjectConfirm] = useState(false)
  const sentVideoRef = useRef(false)

  const sendVideoToFreeCut = useCallback(
    async (iframe: HTMLIFrameElement, includeProject: boolean) => {
      const videoBuffer = await fetch(videoUrl).then((r) => r.arrayBuffer())

      // Optionally fetch project JSON for restore
      let projectJson: unknown = undefined
      if (includeProject && freecutProjectUrl) {
        try {
          projectJson = await fetch(freecutProjectUrl).then((r) => r.json())
          console.warn("[FreeCut] Loaded project JSON from:", freecutProjectUrl)
        } catch (e) {
          console.warn("[FreeCut] Failed to load project JSON:", e)
        }
      } else {
        console.warn("[FreeCut] No project to restore", { includeProject, freecutProjectUrl })
      }

      console.warn("[FreeCut] Sending to iframe", { hasBuffer: !!videoBuffer, hasProjectJson: !!projectJson })
      iframe.contentWindow!.postMessage(
        { type: "NODARO_LOAD_VIDEO", payload: { videoUrl, videoBuffer, projectJson } },
        FREECUT_ORIGIN,
        [videoBuffer],
      )
    },
    [videoUrl, freecutProjectUrl],
  )

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== FREECUT_ORIGIN) return

      if (event.data?.type === "FREECUT_READY") {
        if (!sentVideoRef.current) {
          sentVideoRef.current = true
          const iframe = iframeRef.current
          if (iframe?.contentWindow) {
            sendVideoToFreeCut(iframe, true).catch(() => {
              // Fallback: send URL only
              iframe.contentWindow!.postMessage(
                { type: "NODARO_LOAD_VIDEO", payload: { videoUrl } },
                FREECUT_ORIGIN,
              )
            })
          }
        }
      }

      if (event.data?.type === "FREECUT_EXPORT_COMPLETE") {
        const buffer: ArrayBuffer = event.data.payload?.videoBuffer
        if (!buffer) return
        setSaveState("saving")
        const blob = new Blob([buffer], { type: "video/mp4" })
        const projectJson = event.data.payload?.projectJson
        console.warn("[FreeCut] Export received", { hasBuffer: !!buffer, hasProjectJson: !!projectJson, projectJsonType: typeof projectJson })
        onExportComplete(blob, projectJson).then(() => {
          setSaveState("done")
          setTimeout(() => onClose(), 800)
        }).catch(() => {
          setSaveState("idle")
        })
      }

      if (event.data?.type === "FREECUT_REQUEST_IMPORT") {
        const { accept, multiple } = event.data.payload
        const input = document.createElement("input")
        input.type = "file"
        input.accept = accept || "video/*,audio/*,image/*"
        input.multiple = multiple ?? true
        input.onchange = async () => {
          const files = Array.from(input.files || [])
          if (!files.length) return
          const payload = await Promise.all(
            files.map(async (f) => ({
              name: f.name,
              type: f.type,
              size: f.size,
              buffer: await f.arrayBuffer(),
            })),
          )
          const buffers = payload.map((f) => f.buffer)
          iframeRef.current?.contentWindow?.postMessage(
            { type: "NODARO_IMPORT_FILES", payload: { files: payload } },
            FREECUT_ORIGIN,
            buffers,
          )
        }
        input.click()
      }
    },
    [onExportComplete, onClose, videoUrl, sendVideoToFreeCut],
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setShowCloseConfirm((prev) => !prev)
      }
    },
    [],
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  function handleNewProject() {
    setShowNewProjectConfirm(false)
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "NODARO_RESET_PROJECT", payload: {} },
        FREECUT_ORIGIN,
      )
      // Re-send video without project JSON
      sentVideoRef.current = false
      sendVideoToFreeCut(iframe, false).catch(() => {
        iframe.contentWindow!.postMessage(
          { type: "NODARO_LOAD_VIDEO", payload: { videoUrl } },
          FREECUT_ORIGIN,
        )
      })
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1E1E1E] border-b border-[#2D2D2D] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">FreeCut Editor</span>
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
            onClick={() => setShowNewProjectConfirm(true)}
          >
            <FilePlus className="w-3.5 h-3.5" />
            New Project
          </button>
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

      {/* Saving overlay */}
      {saveState !== "idle" && (
        <div className="absolute inset-0 z-[10000] bg-black/70 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            {saveState === "saving" && (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-white" />
                <span className="text-sm text-white">Saving edited video...</span>
              </>
            )}
            {saveState === "done" && (
              <>
                <Check className="w-8 h-8 text-green-400" />
                <span className="text-sm text-green-400">Saved</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* New project confirmation */}
      {showNewProjectConfirm && (
        <div
          className="absolute inset-0 z-[10000] bg-black/60 flex items-center justify-center"
          onClick={() => setShowNewProjectConfirm(false)}
        >
          <div
            className="bg-[#1E1E1E] border border-[#2D2D2D] rounded-lg p-6 max-w-sm mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-white mb-2">Start a new project?</h3>
            <p className="text-xs text-white/60 mb-4">
              This will discard your current edits and start fresh with the original video.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setShowNewProjectConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                onClick={handleNewProject}
              >
                Start Fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close confirmation */}
      {showCloseConfirm && (
        <div
          className="absolute inset-0 z-[10000] bg-black/60 flex items-center justify-center"
          onClick={() => setShowCloseConfirm(false)}
        >
          <div
            className="bg-[#1E1E1E] border border-[#2D2D2D] rounded-lg p-6 max-w-sm mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-white mb-2">Discard changes?</h3>
            <p className="text-xs text-white/60 mb-4">
              Your edits haven't been sent back. Closing will discard them.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setShowCloseConfirm(false)}
              >
                Continue editing
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                onClick={() => { setShowCloseConfirm(false); onClose() }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
