import { Coins } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"

export { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"

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

  // Pool-aware display (D1 v2): a payg balance is two different moneys — the
  // free pool spends in the studio under free rules, the loaded pool spends
  // via the API/SDK/MCP. One merged number misleads on both sides.
  const isPayg = balance.effectiveTier === "payg"
  const content = (
    <>
      <Coins className="w-4 h-4 text-muted-foreground" />
      {isPayg ? (
        <span className="text-sm font-medium font-mono" title="Free credits (studio) / API credits (SDK, MCP, API)">
          {creditUnits(balance.subscription).toLocaleString()}
          <span className="text-muted-foreground"> free · </span>
          {creditUnits(balance.topup).toLocaleString()}
          <span className="text-muted-foreground"> API</span>
        </span>
      ) : (
        <span className="text-sm font-medium font-mono">{creditUnits(balance.total).toLocaleString()}</span>
      )}
      <span className="text-xs text-muted-foreground hidden sm:inline">{creditUnitLabel("credits")}</span>
      <Badge
        variant="secondary"
        className="text-[10px] px-1.5 py-0 h-4 capitalize"
      >
        {balance.effectiveTier}
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
