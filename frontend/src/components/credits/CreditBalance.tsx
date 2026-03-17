import { Coins } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"

export { useUserCredits } from "@/hooks/queries/use-credits-queries"

interface CreditBalanceProps {
  userId: string
  onClick?: () => void
}

export function CreditBalance({ userId, onClick }: CreditBalanceProps) {
  const { data: balance, isLoading, error } = useUserCredits(userId)

  if (!hasCredits()) return null

  const baseClass = "flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md"

  if (isLoading) {
    return (
      <div className={`${baseClass} animate-pulse`}>
        <div className="w-4 h-4 bg-muted-foreground/20 rounded" />
        <div className="w-12 h-4 bg-muted-foreground/20 rounded" />
      </div>
    )
  }

  if (error || !balance) {
    return (
      <div className={baseClass}>
        <Coins className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">&mdash;</span>
      </div>
    )
  }

  const content = (
    <>
      <Coins className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm font-medium font-mono">{balance.total.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground hidden sm:inline">credits</span>
      <Badge
        variant="secondary"
        className="text-[10px] px-1.5 py-0 h-4 capitalize"
      >
        {balance.tier}
      </Badge>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} cursor-pointer hover:bg-muted/80 transition-colors`}
      >
        {content}
      </button>
    )
  }

  return (
    <div className={baseClass}>
      {content}
    </div>
  )
}
