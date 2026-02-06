"use client"

import { useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { BookmarkPlus, Loader2, Check, X } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { saveGeneratedToLibrary } from "@/lib/api"
import { EDITION } from "@/lib/edition"
import { cn } from "@/lib/utils"

// ============================================================
// Types
// ============================================================

interface SaveToLibraryButtonProps {
  readonly url: string
  readonly type: "image" | "video" | "audio"
  readonly filename?: string
  readonly metadata?: Record<string, unknown>
  /** Compact icon-only mode for node overlays (default: true) */
  readonly compact?: boolean
  /** Additional CSS classes */
  readonly className?: string
}

type SaveState = "idle" | "saving" | "saved" | "error"

// ============================================================
// Admin Dialog (Cloud Edition Only)
// ============================================================

interface AdminDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onSave: (isLibraryItem: boolean) => void
  readonly saving: boolean
}

function AdminSaveDialog({ open, onClose, onSave, saving }: AdminDialogProps) {
  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm bg-background border border-border rounded-xl shadow-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ff0073]/10 flex items-center justify-center">
              <BookmarkPlus className="w-4 h-4 text-[#ff0073]" />
            </div>
            <h2 className="text-base font-semibold">Save to Library</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Where would you like to save this asset?
          </p>

          <button
            type="button"
            onClick={() => onSave(false)}
            disabled={saving}
            className={cn(
              "w-full px-4 py-3 text-left rounded-lg border border-border",
              "hover:border-[#ff0073]/30 hover:bg-muted/30 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <span className="text-sm font-medium">My Library</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Only visible to you
            </p>
          </button>

          <button
            type="button"
            onClick={() => onSave(true)}
            disabled={saving}
            className={cn(
              "w-full px-4 py-3 text-left rounded-lg border border-border",
              "hover:border-[#ff0073]/30 hover:bg-muted/30 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <span className="text-sm font-medium">Shared Library</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Visible to all users
            </p>
          </button>
        </div>

        {/* Saving indicator */}
        {saving && (
          <div className="px-5 pb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving...
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ============================================================
// Main Component
// ============================================================

export function SaveToLibraryButton({
  url,
  type,
  filename,
  metadata,
  compact = true,
  className,
}: SaveToLibraryButtonProps) {
  const { user, isAdmin } = useAuth()
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [showAdminDialog, setShowAdminDialog] = useState(false)

  const handleSave = useCallback(
    async (isLibraryItem: boolean) => {
      if (!user?.id || saveState === "saving") return

      setSaveState("saving")
      try {
        await saveGeneratedToLibrary({
          userId: user.id,
          url,
          type,
          filename,
          metadata,
          isLibraryItem,
        })
        setSaveState("saved")
        setShowAdminDialog(false)
        // Reset after 3 seconds
        setTimeout(() => setSaveState("idle"), 3000)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Save failed"
        // If already exists, treat as "saved"
        if (message.includes("already in your library")) {
          setSaveState("saved")
          setShowAdminDialog(false)
          setTimeout(() => setSaveState("idle"), 3000)
        } else {
          setSaveState("error")
          setTimeout(() => setSaveState("idle"), 3000)
        }
      }
    },
    [user?.id, url, type, filename, metadata, saveState],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      if (saveState === "saving" || saveState === "saved") return

      // Cloud edition + admin -> show dialog
      if (EDITION === "cloud" && isAdmin) {
        setShowAdminDialog(true)
        return
      }

      // Self-hosted or regular user -> save directly to personal library
      handleSave(false)
    },
    [saveState, isAdmin, handleSave],
  )

  if (compact) {
    return (
      <>
        <button
          type="button"
          className={cn(
            "w-5 h-5 flex items-center justify-center rounded-full shadow-sm transition-colors",
            saveState === "saved"
              ? "bg-green-500/80 text-white"
              : saveState === "error"
                ? "bg-red-500/80 text-white"
                : saveState === "saving"
                  ? "bg-[#ff0073]/80 text-white"
                  : "bg-[#ff0073]/80 hover:bg-[#ff0073] text-white",
            className,
          )}
          onClick={handleClick}
          title={
            saveState === "saved"
              ? "Saved to library"
              : saveState === "error"
                ? "Save failed"
                : "Save to library"
          }
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : saveState === "saved" ? (
            <Check className="w-3 h-3" />
          ) : (
            <BookmarkPlus className="w-3 h-3" />
          )}
        </button>

        <AdminSaveDialog
          open={showAdminDialog}
          onClose={() => setShowAdminDialog(false)}
          onSave={handleSave}
          saving={saveState === "saving"}
        />
      </>
    )
  }

  // Full button mode (for use outside node overlays)
  return (
    <>
      <button
        type="button"
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors",
          saveState === "saved"
            ? "bg-green-500/20 text-green-400"
            : saveState === "error"
              ? "bg-red-500/20 text-red-400"
              : "bg-[#ff0073]/10 text-[#ff0073] hover:bg-[#ff0073]/20",
          className,
        )}
        onClick={handleClick}
        disabled={saveState === "saving"}
      >
        {saveState === "saving" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : saveState === "saved" ? (
          <Check className="w-3 h-3" />
        ) : (
          <BookmarkPlus className="w-3 h-3" />
        )}
        {saveState === "saved"
          ? "Saved"
          : saveState === "error"
            ? "Failed"
            : "Save to Library"}
      </button>

      <AdminSaveDialog
        open={showAdminDialog}
        onClose={() => setShowAdminDialog(false)}
        onSave={handleSave}
        saving={saveState === "saving"}
      />
    </>
  )
}
