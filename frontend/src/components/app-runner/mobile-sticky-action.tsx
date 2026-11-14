import { useId } from "react"
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
  /** Why Run waits, said just above the bar (a cloned voice's recordings and tick); empty when it does not. */
  waitReason?: string
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
  waitReason,
}: MobileStickyActionProps) {
  const t = useT()
  const reasonId = useId()
  if (hidden || inputsReadOnly) return null
  const reason = isAuthenticated && !isRunning && !needsMoreCredits && !allInputsFilled && waitReason ? waitReason : ""

  const showNewRun = !!onNewRun

  return (
    <div
      className="fixed start-0 end-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border px-4 flex items-center gap-2"
      style={{
        bottom: "calc(56px + var(--safe-area-bottom, 0px))",
        height: "56px",
      }}
    >
      {reason && (
        <p id={reasonId} role="status" className="absolute bottom-full start-0 end-0 px-4 py-1.5 text-xs text-amber-400 bg-card/95 border-t border-border">
          {reason}
        </p>
      )}
      {showNewRun && (
        <button
          type="button"
          onClick={onNewRun}
          className={`shrink-0 h-11 px-4 rounded-full text-sm font-medium flex items-center gap-2 transition-colors touch-manipulation ${
            isResetAction(newRunAction)
              ? "text-foreground bg-muted hover:bg-muted/80 border border-border"
              : "text-white bg-cta hover:bg-cta-hover"
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
          className="flex-1 h-11 rounded-full text-sm font-medium text-white bg-cta hover:bg-cta-hover flex items-center justify-center gap-2 transition-colors touch-manipulation"
        >
          <Sparkles className="h-4 w-4" />
          {t("runner.getCredits")}
        </button>
      ) : (
        <button
          type="button"
          onClick={onRun}
          disabled={isAuthenticated && !allInputsFilled}
          aria-describedby={reason ? reasonId : undefined}
          className="flex-1 h-11 rounded-full text-sm font-medium text-white bg-cta hover:bg-cta-hover flex items-center justify-center gap-2 transition-colors touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
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
