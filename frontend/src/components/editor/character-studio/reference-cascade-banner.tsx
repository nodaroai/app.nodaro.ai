import { AlertTriangle, X } from "lucide-react"

interface ReferenceCascadeBannerProps {
  readonly visible: boolean
  readonly onDismiss: () => void
  readonly onRegenerateAll?: () => void
}

export function ReferenceCascadeBanner({ visible, onDismiss, onRegenerateAll }: ReferenceCascadeBannerProps) {
  if (!visible) return null
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-md">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 text-[11px] text-amber-200">
        Reference photos changed — regenerate the portrait and assets to apply the new look.
      </div>
      {onRegenerateAll && (
        <button
          type="button"
          onClick={onRegenerateAll}
          className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded px-2 py-1"
        >
          Regenerate all
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="text-amber-400 hover:text-amber-200"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
