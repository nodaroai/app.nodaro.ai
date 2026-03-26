import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Check } from "lucide-react"
import { useTheme } from "next-themes"
import FilerobotImageEditor, { TABS } from "react-filerobot-image-editor"

interface FilerobotEditorModalProps {
  readonly imageUrl: string
  readonly designStateUrl?: string
  readonly onSaveComplete: (imageBlob: Blob, designState: unknown) => Promise<void> | void
  readonly onClose: () => void
}

const ALL_TABS = [TABS.ADJUST, TABS.ANNOTATE, TABS.FILTERS, TABS.FINETUNE, TABS.RESIZE, TABS.WATERMARK]

function buildTheme(isDark: boolean) {
  if (isDark) {
    return {
      palette: {
        "bg-primary": "#121212",
        "bg-secondary": "#1E1E1E",
        "accent-primary": "#ff0073",
        "accent-primary-active": "#e0005f",
        "icons-primary": "#E2E8F0",
        "icons-secondary": "#94A3B8",
        "borders-primary": "#2D2D2D",
        "borders-secondary": "#3D3D3D",
        "text-primary": "#E2E8F0",
        "text-secondary": "#94A3B8",
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
      "bg-secondary": "#FFFFFF",
      "accent-primary": "#ff0073",
      "accent-primary-active": "#e0005f",
      "icons-primary": "#1E293B",
      "icons-secondary": "#64748B",
      "borders-primary": "#E2E8F0",
      "borders-secondary": "#D1D5DB",
      "text-primary": "#1E293B",
      "text-secondary": "#64748B",
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

  // Fetch design state from R2 if URL provided
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
        // Failed to load design state — open editor without it
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
        setTimeout(() => setSaveState("idle"), 1500)
      } catch {
        setSaveState("idle")
      } finally {
        isSavingRef.current = false
      }
    },
    [onSaveComplete],
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
      <div className={`flex items-center justify-between px-4 py-2 border-b shrink-0 ${isDark ? "bg-[#1E1E1E] border-[#2D2D2D]" : "bg-white border-[#E2E8F0]"}`}>
        <span className={`text-sm font-medium ${isDark ? "text-white" : "text-[#1E293B]"}`}>Edit Image</span>
        <div className="flex items-center gap-3">
          {saveState === "saving" && (
            <div className="flex items-center gap-1.5">
              <Loader2 className={`w-4 h-4 animate-spin ${isDark ? "text-white/70" : "text-[#64748B]"}`} />
              <span className={`text-xs ${isDark ? "text-white/70" : "text-[#64748B]"}`}>Saving...</span>
            </div>
          )}
          {saveState === "done" && (
            <div className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-green-400" />
              <span className="text-xs text-green-400">Saved</span>
            </div>
          )}
          <button
            type="button"
            aria-label="Close editor"
            className={`transition-colors ${isDark ? "text-white/70 hover:text-white" : "text-[#64748B] hover:text-[#1E293B]"}`}
            onClick={() => hasChanges ? setShowCloseConfirm(true) : onClose()}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative">
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
