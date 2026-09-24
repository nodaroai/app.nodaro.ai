import { Play, Loader2, LogIn, Sparkles, RotateCcw, Plus } from "lucide-react"
import { useT } from "@/lib/i18n"
import { isResetAction, newRunActionLabel, type NewRunAction } from "./types"

interface MobileStickyActionProps {
  isRunning: boolean
  isAuthenticated: boolean
  allInputsFilled: boolean
  needsMoreCredits: boolean
  costLabel: string
  onRun: () => void
  onCancel?: () => void
  onNewRun?: () => void
  newRunAction?: NewRunAction
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
  newRunAction,
  onGetCredits,
  inputsReadOnly,
  hidden,
}: MobileStickyActionProps) {
  const t = useT()
  if (hidden || inputsReadOnly) return null

  const showNewRun = !!onNewRun

  return (
    <div
      className="fixed start-0 end-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border px-4 flex items-center gap-2"
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
            isResetAction(newRunAction)
              ? "text-foreground bg-muted hover:bg-muted/80 border border-border"
              : "text-white bg-[#ff0073] hover:bg-[#ff0073]/90"
          }`}
        >
          {isResetAction(newRunAction) ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t(newRunActionLabel(newRunAction))}
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
          {t("common.stop")}
        </button>
      ) : needsMoreCredits ? (
        <button
          type="button"
          onClick={onGetCredits}
          className="flex-1 h-11 rounded-full text-sm font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 flex items-center justify-center gap-2 transition-colors touch-manipulation"
        >
          <Sparkles className="h-4 w-4" />
          {t("runner.getCredits")}
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
              {t("present.signInToRun")}
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              {t("present.run")}{costLabel}
            </>
          )}
        </button>
      )}
    </div>
  )
}
