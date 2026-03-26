import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Loader2, Check } from "lucide-react"
import { useTheme } from "next-themes"
import FilerobotImageEditor, { TABS } from "react-filerobot-image-editor"

interface FilerobotEditorModalProps {
  readonly imageUrl: string
  readonly designStateUrl?: string
  readonly onSaveComplete: (imageBlob: Blob, designState: unknown) => Promise<void> | void
  readonly onClose: () => void
}

const ALL_TABS = [TABS.ADJUST, TABS.ANNOTATE, TABS.FILTERS, TABS.FINETUNE, TABS.RESIZE]

function buildTheme(isDark: boolean) {
  if (isDark) {
    return {
      palette: {
        "bg-primary": "#121212",
        "bg-primary-active": "#1E1E1E",
        "bg-secondary": "#1E1E1E",
        "accent-primary": "#ff0073",
        "accent-primary-active": "#e0005f",
        "icons-primary": "#E2E8F0",
        "icons-secondary": "#94A3B8",
        "icons-primary-opacity-0.6": "rgba(226,232,240,0.6)",
        "borders-primary": "#2D2D2D",
        "borders-secondary": "#3D3D3D",
        "borders-strong": "#4D4D4D",
        "text-primary": "#E2E8F0",
        "text-primary-invert": "#121212",
        "text-secondary": "#94A3B8",
        "btn-primary-text": "#FFFFFF",
        "btn-disabled-text": "#64748B",
        "active-secondary": "#2D2D2D",
        "active-secondary-hover": "#3D3D3D",
        "link-primary": "#ff0073",
        warning: "#F59E0B",
        error: "#EF4444",
      },
      typography: {
        fontFamily: "inherit",
      },
    }
  }
  return {
    palette: {
      "bg-primary": "#F8FAFC",
      "bg-primary-active": "#FFFFFF",
      "bg-secondary": "#FFFFFF",
      "accent-primary": "#ff0073",
      "accent-primary-active": "#e0005f",
      "icons-primary": "#1E293B",
      "icons-secondary": "#64748B",
      "icons-primary-opacity-0.6": "rgba(30,41,59,0.6)",
      "borders-primary": "#E2E8F0",
      "borders-secondary": "#D1D5DB",
      "borders-strong": "#94A3B8",
      "text-primary": "#1E293B",
      "text-primary-invert": "#FFFFFF",
      "text-secondary": "#64748B",
      "btn-primary-text": "#FFFFFF",
      "btn-disabled-text": "#94A3B8",
      "active-secondary": "#F1F5F9",
      "active-secondary-hover": "#E2E8F0",
      "link-primary": "#ff0073",
      warning: "#F59E0B",
      error: "#EF4444",
    },
    typography: {
      fontFamily: "inherit",
    },
  }
}

export function FilerobotEditorModal({
  imageUrl,
  designStateUrl,
  onSaveComplete,
  onClose,
}: FilerobotEditorModalProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"

  const [saveState, setSaveState] = useState<"idle" | "saving" | "done">("idle")
  const isSavingRef = useRef(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [loadedDesignState, setLoadedDesignState] = useState<unknown>(undefined)
  const [designStateFetched, setDesignStateFetched] = useState(!designStateUrl)

  useEffect(() => {
    if (!designStateUrl) return
    let cancelled = false
    fetch(designStateUrl)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setLoadedDesignState(data)
          setDesignStateFetched(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesignStateFetched(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [designStateUrl])

  const theme = useMemo(() => buildTheme(isDark), [isDark])

  const handleSave = useCallback(
    async (editedImageObject: { imageBase64?: string; mimeType?: string }, designState: unknown) => {
      const base64Data = editedImageObject.imageBase64
      if (!base64Data || isSavingRef.current) return

      isSavingRef.current = true
      setSaveState("saving")

      try {
        const byteString = atob(
          base64Data.includes(",") ? base64Data.split(",")[1] : base64Data,
        )
        const mimeType = editedImageObject.mimeType || "image/png"
        const ab = new ArrayBuffer(byteString.length)
        const ia = new Uint8Array(ab)
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i)
        }
        const blob = new Blob([ab], { type: mimeType })

        await onSaveComplete(blob, designState)
        setSaveState("done")
        setHasChanges(false)
        // Close after brief "Saved" feedback
        setTimeout(() => onClose(), 600)
      } catch {
        setSaveState("idle")
      } finally {
        isSavingRef.current = false
      }
    },
    [onSaveComplete, onClose],
  )

  const handleClose = useCallback(
    (_closingReason: string, hasUnsavedChanges: boolean) => {
      if (hasUnsavedChanges) {
        setShowCloseConfirm(true)
      } else {
        onClose()
      }
    },
    [onClose],
  )

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Saving overlay indicator */}
      {saveState !== "idle" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[10001] flex items-center gap-2 px-4 py-2 rounded-full bg-black/80 backdrop-blur-sm border border-white/10 shadow-lg">
          {saveState === "saving" && (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white/70" />
              <span className="text-xs text-white/70">Saving...</span>
            </>
          )}
          {saveState === "done" && (
            <>
              <Check className="w-4 h-4 text-green-400" />
              <span className="text-xs text-green-400">Saved</span>
            </>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {!designStateFetched ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="w-8 h-8 animate-spin text-white/50" />
          </div>
        ) : (
          <FilerobotImageEditor
            source={imageUrl}
            onSave={handleSave}
            onClose={handleClose}
            onModify={() => setHasChanges(true)}
            closeAfterSave={false}
            tabsIds={ALL_TABS}
            defaultTabId={TABS.ADJUST}
            theme={theme}
            savingPixelRatio={4}
            previewPixelRatio={window.devicePixelRatio || 1}
            avoidChangesNotSavedAlertOnLeave
            defaultSavedImageType="png"
            showBackButton={false}
            {...(loadedDesignState ? { loadableDesignState: loadedDesignState as Record<string, unknown> } : {})}
          />
        )}
      </div>

      {showCloseConfirm && (
        <div
          className="absolute inset-0 z-[10000] bg-black/60 flex items-center justify-center"
          onClick={() => setShowCloseConfirm(false)}
        >
          <div
            className={`rounded-lg p-6 max-w-sm mx-4 shadow-xl border ${isDark ? "bg-[#1E1E1E] border-[#2D2D2D]" : "bg-white border-[#E2E8F0]"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={`text-sm font-medium mb-2 ${isDark ? "text-white" : "text-[#1E293B]"}`}>Discard changes?</h3>
            <p className={`text-xs mb-4 ${isDark ? "text-white/60" : "text-[#64748B]"}`}>
              Your edits haven&apos;t been saved. Closing will discard them.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${isDark ? "text-white/70 hover:text-white hover:bg-white/10" : "text-[#64748B] hover:text-[#1E293B] hover:bg-black/5"}`}
                onClick={() => setShowCloseConfirm(false)}
              >
                Continue editing
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                onClick={() => {
                  setShowCloseConfirm(false)
                  onClose()
                }}
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
