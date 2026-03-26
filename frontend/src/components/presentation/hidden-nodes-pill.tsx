import { Eye, EyeOff } from "lucide-react"

interface HiddenNodesPillProps {
  count: number
  isRevealing: boolean
  onToggleReveal: () => void
}

export function HiddenNodesPill({ count, isRevealing, onToggleReveal }: HiddenNodesPillProps) {
  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={onToggleReveal}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
        bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground
        border border-border/50 transition-colors"
    >
      {isRevealing ? (
        <>
          <EyeOff className="w-3.5 h-3.5" />
          Showing {count} hidden — Done
        </>
      ) : (
        <>
          <Eye className="w-3.5 h-3.5" />
          {count} hidden — Show all
        </>
      )}
    </button>
  )
}
