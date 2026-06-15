import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Loader2, Check, X } from "lucide-react"
import { useTheme } from "next-themes"
import FilerobotImageEditor, { TABS } from "react-filerobot-image-editor"

interface FilerobotEditorModalProps {
  readonly imageUrl: string
  readonly designStateUrl?: string
  readonly onSaveComplete: (imageBlob: Blob, designState: unknown) => Promise<void> | void
  readonly onClose: () => void
}

const ALL_TABS = [TABS.ADJUST, TABS.ANNOTATE, TABS.FILTERS, TABS.FINETUNE, TABS.RESIZE]

/** Aspect-ratio presets the user can pick from when cropping inside the
 *  Filerobot editor. Without these, the crop tool defaults to "Custom" only
 *  and the ratio-selector row is empty — matching the bug report ("I cannot
 *  change the ratio when cropping"). Mirrors the presets the MediaEditor
 *  upload flow shows. `ratio: 0` is Filerobot's convention for "original". */
const CROP_PRESETS = [
  { titleKey: "Original", descriptionKey: "Source ratio", ratio: 0 },
  { titleKey: "Freeform", descriptionKey: "Any", ratio: "custom" as const },
  { titleKey: "Square", descriptionKey: "1:1", ratio: 1 },
  { titleKey: "Portrait", descriptionKey: "3:4", ratio: 3 / 4 },
  { titleKey: "Landscape", descriptionKey: "4:3", ratio: 4 / 3 },
  { titleKey: "Widescreen", descriptionKey: "16:9", ratio: 16 / 9 },
  { titleKey: "Vertical", descriptionKey: "9:16", ratio: 9 / 16 },
  { titleKey: "Cinematic", descriptionKey: "21:9", ratio: 21 / 9 },
  { titleKey: "Classic", descriptionKey: "3:2", ratio: 3 / 2 },
  { titleKey: "Tall", descriptionKey: "2:3", ratio: 2 / 3 },
  { titleKey: "Ultra-wide", descriptionKey: "2.39:1", ratio: 2.39 },
]

/** Build Filerobot palette using the actual @scaleflex/ui Color enum keys */
function buildTheme(isDark: boolean) {
  const common = {
    // Accent / brand
    "accent-primary": "#ff0073",
    "accent-primary-hover": "#e0005f",
    "accent-primary-active": "#cc0056",
    "accent-primary-disabled": "#3D3D3D",
    "accent-stateless": "#ff0073",
    // Buttons
    "btn-primary-text": "#FFFFFF",
    "btn-primary-text-0-6": "rgba(255,255,255,0.6)",
    "btn-primary-text-0-4": "rgba(255,255,255,0.4)",
    // Links
    "link-primary": "#ff0073",
    "link-stateless": "#ff0073",
    "link-hover": "#e0005f",
    "link-active": "#cc0056",
    // States
    warning: "#F59E0B",
    "warning-hover": "#D97706",
    error: "#EF4444",
    "error-hover": "#DC2626",
    "error-active": "#B91C1C",
    success: "#22C55E",
    info: "#3B82F6",
  }

  if (isDark) {
    return {
      palette: {
        ...common,
        // Backgrounds
        "bg-primary": "#121212",
        "bg-primary-active": "#1A1A1A",
        "bg-primary-hover": "#1A1A1A",
        "bg-primary-light": "#1E1E1E",
        "bg-secondary": "#1E1E1E",
        "bg-stateless": "#1E1E1E",
        "bg-hover": "#1E1E1E",
        "bg-active": "#252525",
        "bg-grey": "#2D2D2D",
        "bg-tooltip": "#333333",
        "bg-primary-0-5-opacity": "rgba(18,18,18,0.5)",
        "bg-primary-stateless": "#2D2D2D",
        // Text
        "txt-primary": "#E2E8F0",
        "txt-secondary": "#94A3B8",
        "txt-secondary-invert": "#94A3B8",
        "txt-placeholder": "#64748B",
        // Icons
        "icon-primary": "#E2E8F0",
        "icons-primary-opacity-0-6": "rgba(226,232,240,0.6)",
        "icons-secondary": "#94A3B8",
        "icons-placeholder": "#4D4D4D",
        "icons-invert": "#121212",
        "icons-muted": "#64748B",
        "icons-primary-hover": "#FFFFFF",
        "icons-secondary-hover": "#E2E8F0",
        // Borders
        "borders-primary": "#2D2D2D",
        "borders-primary-hover": "#4D4D4D",
        "borders-secondary": "#252525",
        "borders-strong": "#4D4D4D",
        "borders-invert": "#4D4D4D",
        "borders-item": "#2D2D2D",
        "borders-button": "#4D4D4D",
        // Buttons
        "btn-disabled-text": "#64748B",
        "btn-secondary-text": "#E2E8F0",
        // Active states (menus, selected items)
        "active-secondary": "#1E1E1E",
        "active-secondary-hover": "#252525",
      },
      typography: { fontFamily: "inherit" },
    }
  }

  return {
    palette: {
      ...common,
      // Backgrounds
      "bg-primary": "#F8FAFC",
      "bg-primary-active": "#F1F5F9",
      "bg-primary-hover": "#F1F5F9",
      "bg-primary-light": "#F8FAFC",
      "bg-secondary": "#FFFFFF",
      "bg-stateless": "#FFFFFF",
      "bg-hover": "#F8FAFC",
      "bg-active": "#F1F5F9",
      "bg-grey": "#E2E8F0",
      "bg-tooltip": "#334155",
      // Text
      "txt-primary": "#1E293B",
      "txt-secondary": "#64748B",
      "txt-secondary-invert": "#94A3B8",
      "txt-placeholder": "#94A3B8",
      // Icons
      "icon-primary": "#64748B",
      "icons-primary-opacity-0-6": "rgba(30,41,59,0.6)",
      "icons-secondary": "#94A3B8",
      "icons-placeholder": "#CBD5E1",
      "icons-invert": "#FFFFFF",
      "icons-muted": "#94A3B8",
      "icons-primary-hover": "#1E293B",
      "icons-secondary-hover": "#64748B",
      // Borders
      "borders-primary": "#E2E8F0",
      "borders-primary-hover": "#94A3B8",
      "borders-secondary": "#F1F5F9",
      "borders-strong": "#CBD5E1",
      "borders-invert": "#64748B",
      "borders-item": "#E2E8F0",
      "borders-button": "#94A3B8",
      // Buttons
      "btn-disabled-text": "#94A3B8",
      "btn-secondary-text": "#1E293B",
      // Active states
      "active-secondary": "#FFFFFF",
      "active-secondary-hover": "#F1F5F9",
    },
    typography: { fontFamily: "inherit" },
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
        if (!cancelled) setDesignStateFetched(true)
      })
    return () => { cancelled = true }
  }, [designStateUrl])

  const theme = useMemo(() => buildTheme(isDark), [isDark])

  const handleSave = useCallback(
    async (imageData: { imageBase64?: string; mimeType?: string }, designState: unknown) => {
      const base64Data = imageData.imageBase64
      if (!base64Data || isSavingRef.current) return

      isSavingRef.current = true
      setSaveState("saving")

      try {
        const byteString = atob(
          base64Data.includes(",") ? base64Data.split(",")[1] : base64Data,
        )
        const mimeType = imageData.mimeType || "image/png"
        const ab = new ArrayBuffer(byteString.length)
        const ia = new Uint8Array(ab)
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i)
        }
        const blob = new Blob([ab], { type: mimeType })

        await onSaveComplete(blob, designState)
        setSaveState("done")
        setHasChanges(false)
        setTimeout(() => onClose(), 600)
      } catch {
        setSaveState("idle")
      } finally {
        isSavingRef.current = false
      }
    },
    [onSaveComplete, onClose],
  )

  // Return false to skip "Save As" modal — triggers onSave directly
  const handleBeforeSave = useCallback(() => false as const, [])

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
      {saveState !== "idle" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[10001] flex items-center gap-2 px-4 py-2 rounded-full bg-black/80 backdrop-blur-sm border border-white/10 shadow-lg pointer-events-none">
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

      {/* Our close button — replaces Filerobot's broken one (library bug: isResetted=false disables click) */}
      <button
        type="button"
        aria-label="Close editor"
        className="absolute top-2 right-2 z-[10001] w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors"
        onClick={() => hasChanges ? setShowCloseConfirm(true) : onClose()}
      >
        <X className={`w-5 h-5 ${isDark ? "text-white/70 hover:text-white" : "text-[#64748B] hover:text-[#1E293B]"}`} />
      </button>

      {/* Hide Filerobot's broken close button + fix hardcoded white spinner overlay */}
      {/*
        Lift every Filerobot popup/dropdown/modal above this overlay.

        Filerobot renders its floating UI through @scaleflex/ui, which portals each
        layer to <body> at a low z-index:
          • Popper  (.SfxPopper-wrapper, z 1300) — pen/shape/text option popups
            (opacity/stroke/shadow), AND every <Select> dropdown (e.g. text font family,
            since Select renders through Menu → Popper)
          • Modal   (.SfxModal-Wrapper, z 1200/1301) — color picker (stroke + text color),
            confirmation/save dialogs
          • Popup   (.SfxPopup-root, z 1400) — editor feedback/error messages
          • Drawer  (.SfxDrawer-temporary, z 1200) — tabs panel on narrow screens

        This editor is an opaque z-[9999] overlay also portaled to <body>, so all of the
        above open *behind* it and look dead — clicking an option icon does nothing, and
        pen/text color + size (which live inside those popups) can't be changed. Raise
        each portaled layer above the overlay, preserving their relative order
        (popper < modal < popup). @scaleflex is used only by Filerobot here, so these
        global rules are scoped to the editor in practice. Re-verify these class names
        if react-filerobot-image-editor is upgraded.

        Two more theme/clipping fixes below:
        • The pen/shape/text option popups (.FIE_annotation-option-popup) inherit the
          generic Menu's `overflow: hidden auto`, which clips the stroke/opacity/shadow
          slider's value tooltip (the "60 px" bubble that pops above the thumb). The
          popups hold tiny fixed content, so `overflow: visible` is safe and lets the
          tooltip show.
        • Filerobot's filter carousel scroll-arrows hardcode a white fade gradient
          (Carousel.styled.js). It matches the strip in light mode but shows as a white
          smudge over the dark strip, so override it to the dark strip colour when dark.
      */}
      <style>{`
        .FIE_buttons-close-btn { display: none !important; }
        .sc-m42fbk-0 { background: ${isDark ? "rgba(18,18,18,0.85)" : "rgba(248,250,252,0.85)"} !important; }
        .SfxPopper-wrapper { z-index: 10000 !important; }
        .SfxDrawer-temporary { z-index: 10000 !important; }
        .SfxModal-Wrapper { z-index: 10001 !important; }
        .SfxPopup-root { z-index: 10002 !important; }
        .FIE_annotation-option-popup { overflow: visible !important; }
        ${isDark ? `
        .FIE_carousel-prev-button { background: linear-gradient(90deg, #1E1E1E 1.56%, rgba(30,30,30,0.89) 52.4%, rgba(30,30,30,0.53) 76.04%, rgba(30,30,30,0) 100%) !important; }
        .FIE_carousel-next-button { background: linear-gradient(270deg, #1E1E1E 1.56%, rgba(30,30,30,0.89) 52.4%, rgba(30,30,30,0.53) 76.04%, rgba(30,30,30,0) 100%) !important; }
        ` : ""}
      `}</style>

      <div className="flex-1 min-h-0 overflow-hidden">
        {!designStateFetched ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="w-8 h-8 animate-spin text-white/50" />
          </div>
        ) : (
          <FilerobotImageEditor
            source={imageUrl}
            onBeforeSave={handleBeforeSave}
            onSave={handleSave}
            onClose={handleClose}
            onModify={() => setHasChanges(true)}
            closeAfterSave={false}
            disableSaveIfNoChanges
            tabsIds={ALL_TABS}
            defaultTabId={TABS.ADJUST}
            theme={theme}
            translations={{ save: "Save & Close" }}
            savingPixelRatio={4}
            previewPixelRatio={window.devicePixelRatio || 1}
            avoidChangesNotSavedAlertOnLeave
            useBackendTranslations={false}
            defaultSavedImageType="png"
            showBackButton={false}
            Crop={{
              presetsItems: CROP_PRESETS,
              autoResize: true,
            }}
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
