import { Coins } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"

export { useUserCredits } from "@/hooks/queries/use-credits-queries"

interface CreditBalanceProps {
  userId: string
}

export function CreditBalance({ userId }: CreditBalanceProps) {
  const { data: balance, isLoading, error } = useUserCredits(userId)

  if (!hasCredits()) return null

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md animate-pulse">
        <div className="w-4 h-4 bg-muted-foreground/20 rounded" />
        <div className="w-12 h-4 bg-muted-foreground/20 rounded" />
      </div>
    )
  }

  if (error || !balance) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
        <Coins className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">&mdash;</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
      <Coins className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm font-medium font-mono">{balance.total.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground">credits</span>
      <Badge
        variant="secondary"
        className="text-[10px] px-1.5 py-0 h-4 capitalize"
      >
        {balance.tier}
      </Badge>
    </div>
  )
}
