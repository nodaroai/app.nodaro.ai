"use client"
import { useEffect, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Check } from "lucide-react"
import { runtimeAudiomassOrigin, runtimeAudiomassUrl } from "@/lib/runtime-config"
import { useT } from "@/lib/i18n"

/**
 * Read at RUNTIME, not inlined at build time — same reason as FreeCut (#767):
 * the cloud/community image is built once and must be repointable at a
 * self-hosted AudioMass with an `AUDIOMASS_URL` value and a restart. Both
 * values come from the same getter pair, so the frame URL and the postMessage
 * origin check can never disagree. Empty means no editor is configured.
 */
const audiomassUrl = () => runtimeAudiomassUrl()
const audiomassOrigin = () => runtimeAudiomassOrigin()

interface AudiomassEditorModalProps {
  readonly audioUrl: string
  readonly onExportComplete: (audioBlob: Blob) => Promise<void>
  readonly onClose: () => void
}

export function AudiomassEditorModal({ audioUrl, onExportComplete, onClose }: AudiomassEditorModalProps) {
  const t = useT()
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

  // An `<iframe src="">` loads the PARENT document — the app inside its own
  // editor. The presentation / app-runner surface mounts this modal from its
  // own state, so the guard lives here where every caller passes through
  // (mirrors FreeCutEditorModal's editorDisabled).
  const editorDisabled = audiomassUrl() === ""

  // Send audio to Audiomass once ready
  const sendAudio = useCallback(async () => {
    if (sentAudioRef.current || !iframeRef.current?.contentWindow) return
    sentAudioRef.current = true

    try {
      const res = await fetch(audioUrl)
      const buffer = await res.arrayBuffer()
      iframeRef.current.contentWindow.postMessage(
        { type: "NODARO_LOAD_AUDIO", payload: { audioUrl, audioBuffer: buffer } },
        audiomassOrigin(),
        [buffer],
      )
    } catch {
      // Fallback: send URL only
      iframeRef.current?.contentWindow?.postMessage(
        { type: "NODARO_LOAD_AUDIO", payload: { audioUrl } },
        audiomassOrigin(),
      )
    }
  }, [audioUrl])

  // Listen for messages from Audiomass (stable deps via refs)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const origin = audiomassOrigin()
      if (!origin || event.origin !== origin) return
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
        <span className="text-sm font-medium text-white/80">{t("mediaed.audioEditorTitle")}</span>
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
        {editorDisabled ? (
          <EditorDisabled />
        ) : (
          <>
            {!iframeLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <Loader2 className="w-8 h-8 text-[#ff0073] animate-spin" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={audiomassUrl()}
              className="w-full h-full border-0"
              allow="autoplay"
              title={t("mediaed.audiomassFrameTitle")}
            />
          </>
        )}
      </div>

      {/* Save overlay */}
      {saveState !== "idle" && (
        <div className="absolute inset-0 z-[10000] flex items-center justify-center bg-black/70">
          {saveState === "saving" ? (
            <div className="flex items-center gap-3 text-white">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>{t("mediaed.savingAudio")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-emerald-400">
              <Check className="w-6 h-6" />
              <span>{t("common.saved")}</span>
            </div>
          )}
        </div>
      )}

      {/* Close confirmation */}
      {showCloseConfirm && (
        <div className="absolute inset-0 z-[10000] flex items-center justify-center bg-black/80">
          <div className="bg-[#1e1e2e] rounded-xl p-6 max-w-sm mx-4 border border-white/10">
            <h3 className="text-lg font-semibold text-white mb-2">{t("mediaed.discardChangesTitle")}</h3>
            <p className="text-sm text-white/60 mb-6">{t("mediaed.discardBodyAudio")}</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                {t("mediaed.continueEditing")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                {t("node.discard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

/** No editor configured (`AUDIOMASS_URL=off`, or none set). Says so instead of framing nothing. */
function EditorDisabled() {
  const t = useT()
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black p-8">
      <p className="max-w-md text-center text-white/60 text-xs leading-relaxed">
        {t("mediaed.noAudioEditorA")}{" "}
        <span className="font-mono">AUDIOMASS_URL</span> {t("mediaed.noAudioEditorB")}
      </p>
    </div>
  )
}
