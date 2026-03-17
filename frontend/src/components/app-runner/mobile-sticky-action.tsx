import { Play, Loader2, LogIn, Sparkles, RotateCcw, Plus } from "lucide-react"

interface MobileStickyActionProps {
  isRunning: boolean
  isAuthenticated: boolean
  allInputsFilled: boolean
  needsMoreCredits: boolean
  costLabel: string
  onRun: () => void
  onCancel?: () => void
  onNewRun?: () => void
  newRunLabel?: string
  onGetCredits: () => void
  inputsReadOnly?: boolean
  hidden: boolean
}

export function MobileStickyAction({
  isRunning,
  isAuthenticated,
  allInputsFilled,
  needsMoreCredits,
  costLabel,
  onRun,
  onCancel,
  onNewRun,
  newRunLabel,
  onGetCredits,
  inputsReadOnly,
  hidden,
}: MobileStickyActionProps) {
  if (hidden || inputsReadOnly) return null

  const showNewRun = !!onNewRun

  return (
    <div
      className="fixed left-0 right-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border px-4 flex items-center gap-2"
      style={{
        bottom: "calc(56px + var(--safe-area-bottom, 0px))",
        height: "56px",
      }}
    >
      {showNewRun && (
        <button
          type="button"
          onClick={onNewRun}
          className={`shrink-0 h-11 px-4 rounded-full text-sm font-medium flex items-center gap-2 transition-colors touch-manipulation ${
            newRunLabel === "Retry" || newRunLabel === "Clear"
              ? "text-foreground bg-muted hover:bg-muted/80 border border-border"
              : "text-white bg-[#ff0073] hover:bg-[#ff0073]/90"
          }`}
        >
          {newRunLabel === "Retry" || newRunLabel === "Clear" ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {newRunLabel ?? "New Run"}
        </button>
      )}

      {isRunning ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={!onCancel}
          className="flex-1 h-11 rounded-full text-sm font-medium text-white bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 transition-colors touch-manipulation disabled:opacity-50"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Stop
        </button>
      ) : needsMoreCredits ? (
        <button
          type="button"
          onClick={onGetCredits}
          className="flex-1 h-11 rounded-full text-sm font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 flex items-center justify-center gap-2 transition-colors touch-manipulation"
        >
          <Sparkles className="h-4 w-4" />
          Get Credits
        </button>
      ) : (
        <button
          type="button"
          onClick={onRun}
          disabled={isAuthenticated && !allInputsFilled}
          className="flex-1 h-11 rounded-full text-sm font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 flex items-center justify-center gap-2 transition-colors touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!isAuthenticated ? (
            <>
              <LogIn className="h-4 w-4" />
              Sign in to Run
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run{costLabel}
            </>
          )}
        </button>
      )}
    </div>
  )
}
