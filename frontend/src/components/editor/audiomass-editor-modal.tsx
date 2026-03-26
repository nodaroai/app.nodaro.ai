"use client"
import { useEffect, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Check } from "lucide-react"

const AUDIOMASS_URL = import.meta.env.VITE_AUDIOMASS_URL || "http://localhost:5175"
const AUDIOMASS_ORIGIN = new URL(AUDIOMASS_URL).origin

interface AudiomassEditorModalProps {
  readonly audioUrl: string
  readonly onExportComplete: (audioBlob: Blob) => Promise<void>
  readonly onClose: () => void
}

export function AudiomassEditorModal({ audioUrl, onExportComplete, onClose }: AudiomassEditorModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done">("idle")
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const sentAudioRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const onExportRef = useRef(onExportComplete)
  const onCloseRef = useRef(onClose)
  onExportRef.current = onExportComplete
  onCloseRef.current = onClose

  // Send audio to Audiomass once ready
  const sendAudio = useCallback(async () => {
    if (sentAudioRef.current || !iframeRef.current?.contentWindow) return
    sentAudioRef.current = true

    try {
      const res = await fetch(audioUrl)
      const buffer = await res.arrayBuffer()
      iframeRef.current.contentWindow.postMessage(
        { type: "NODARO_LOAD_AUDIO", payload: { audioUrl, audioBuffer: buffer } },
        AUDIOMASS_ORIGIN,
        [buffer],
      )
    } catch {
      // Fallback: send URL only
      iframeRef.current?.contentWindow?.postMessage(
        { type: "NODARO_LOAD_AUDIO", payload: { audioUrl } },
        AUDIOMASS_ORIGIN,
      )
    }
  }, [audioUrl])

  // Listen for messages from Audiomass (stable deps via refs)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== AUDIOMASS_ORIGIN) return
      const { type, payload } = event.data || {}

      if (type === "AUDIOMASS_READY") {
        setIframeLoaded(true)
        sendAudio()
      }

      if (type === "AUDIOMASS_EXPORT_COMPLETE" && payload?.audioBuffer) {
        setSaveState("saving")
        const blob = new Blob([payload.audioBuffer], { type: payload.mimeType || "audio/mp3" })
        onExportRef.current(blob)
          .then(() => {
            setSaveState("done")
            closeTimerRef.current = setTimeout(() => onCloseRef.current(), 800)
          })
          .catch(() => setSaveState("idle"))
      }
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [sendAudio])

  // Escape key handler
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        setShowCloseConfirm(true)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 bg-[#1a1a2e] border-b border-white/10 shrink-0">
        <span className="text-sm font-medium text-white/80">Audio Editor</span>
        <button
          type="button"
          onClick={() => setShowCloseConfirm(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="w-8 h-8 text-[#ff0073] animate-spin" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={AUDIOMASS_URL}
          className="w-full h-full border-0"
          allow="autoplay"
          title="Audiomass Audio Editor"
        />
      </div>

      {/* Save overlay */}
      {saveState !== "idle" && (
        <div className="absolute inset-0 z-[10000] flex items-center justify-center bg-black/70">
          {saveState === "saving" ? (
            <div className="flex items-center gap-3 text-white">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Saving edited audio...</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-emerald-400">
              <Check className="w-6 h-6" />
              <span>Saved</span>
            </div>
          )}
        </div>
      )}

      {/* Close confirmation */}
      {showCloseConfirm && (
        <div className="absolute inset-0 z-[10000] flex items-center justify-center bg-black/80">
          <div className="bg-[#1e1e2e] rounded-xl p-6 max-w-sm mx-4 border border-white/10">
            <h3 className="text-lg font-semibold text-white mb-2">Discard changes?</h3>
            <p className="text-sm text-white/60 mb-6">Your edits will not be saved.</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                Continue editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
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
