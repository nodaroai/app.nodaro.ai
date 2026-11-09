import { Coins } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { creditUnits, creditUnitLabel, displayUnitLabel } from "@/lib/credit-units"
import { spendableCredits, spendableDisplayFigure } from "@/lib/spendable-credits"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"

export { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"

interface CreditBalanceProps {
  userId: string
  onClick?: () => void
}

export function CreditBalance({ userId, onClick }: CreditBalanceProps) {
  const t = useT()
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

  // A deployment that shows its own unit: the figures are the server's
  // (`display`), and are shown as they came. Which one is the rule every
  // balance readout shares (`spendable-credits.ts`): a shared wallet's
  // available figure, else the caller's allowance, else the total. It is one
  // number, whatever the plan is called.
  const { display } = balance
  const converted = display ? spendableDisplayFigure(balance, display) : null

  // Pool-aware display (D1 v2): a payg balance is two different moneys — the
  // free pool spends in the studio under free rules, the loaded pool spends
  // via the API/SDK/MCP. One merged number misleads on both sides. Only where
  // the account's own wallet is what gets spent: a shared wallet or an
  // allowance is one figure.
  const isPayg = balance.effectiveTier === "payg" && !display && !balance.externalWallet && !balance.allowance

  // Without `display` these are Nodaro credits, converted at render. A shared
  // wallet the server could not read is unknown, never 0.
  const raw = spendableCredits(balance, false)
  const figure = display
    ? converted === null ? "—" : formatNumber(converted, { maximumFractionDigits: display.decimals })
    : balance.externalWallet?.available === null ? "—" : formatNumber(creditUnits(raw.displayFigure))

  const content = (
    <>
      <Coins className="w-4 h-4 text-muted-foreground" />
      {isPayg ? (
        <span className="text-sm font-medium font-mono" title={t("credits.balancePoolsTitle")}>
          {formatNumber(creditUnits(balance.subscription))}
          <span className="text-muted-foreground"> {t("credits.balanceFree")} · </span>
          {formatNumber(creditUnits(balance.topup))}
          <span className="text-muted-foreground"> API</span>
        </span>
      ) : (
        <span className="text-sm font-medium font-mono">{figure}</span>
      )}
      <span className="text-xs text-muted-foreground hidden sm:inline">
        {display ? displayUnitLabel(display, t("credits.unit.other")) : creditUnitLabel(t("credits.unit.other"))}
      </span>
      {/* Nothing is sold here (`billing.selfServe: false`), so there is no plan to name. */}
      {surfaceBillingSelfServe() && (
        <Badge
          variant="secondary"
          className="text-[11px] px-1.5 py-0 h-4 capitalize"
        >
          {balance.effectiveTier}
        </Badge>
      )}
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
