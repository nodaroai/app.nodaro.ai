import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Loader2 } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import { RUN_BUTTON_CLASS } from "@/lib/run-button-style"
import { useModelCreditCost, useUserCredits } from "@/ee/hooks/queries/use-credits-queries"

interface GenerateButtonProps {
  onClick: () => void
  disabled?: boolean
  isRunning?: boolean
  modelIdentifier: string
  userId: string
  label?: string
  children?: React.ReactNode
  /** Override the credit cost shown on the button (e.g. for component nodes,
   *  or to supply a multi-provider sum). */
  creditOverride?: number
  /** Multiplier applied on top of the resolved credit cost — used for
   *  repeatCount and other "this many runs per press" semantics. */
  multiplier?: number
}

export function GenerateButton({
  onClick,
  disabled = false,
  isRunning = false,
  modelIdentifier,
  userId,
  label,
  children,
  creditOverride,
  multiplier = 1,
}: GenerateButtonProps) {
  const t = useT()
  const { data: lookedUp } = useModelCreditCost(modelIdentifier)
  const baseCost = creditOverride ?? lookedUp
  const totalCost = baseCost != null ? baseCost * Math.max(multiplier, 1) : undefined
  const { data: balance } = useUserCredits(userId)

  const creditsActive = hasCredits()
  const totalBalance = balance?.total ?? 0
  const insufficient = creditsActive && totalCost != null && totalCost > 0 && totalBalance < totalCost

  const showCreditInfo = creditsActive && totalCost != null && totalCost > 0

  const buttonContent = (
    <>
      {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
      {isRunning ? t("credits.processing") : (children ?? label ?? t("credits.generate"))}
      {showCreditInfo && !isRunning && (
        <span className="ml-1 opacity-80">
          {t("credits.amount", {
            n: totalCost as number,
            unit: totalCost === 1 ? t("credits.unit.one") : t("credits.unit.other"),
          })}
        </span>
      )}
    </>
  )

  const button = (
    <Button
      onClick={onClick}
      disabled={disabled || isRunning || insufficient}
      className={`w-full ${RUN_BUTTON_CLASS}`}
    >
      {buttonContent}
    </Button>
  )

  if (insufficient) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="w-full">{button}</span>
        </TooltipTrigger>
        <TooltipContent>
          {t("credits.insufficientTooltip", { need: totalCost as number, have: totalBalance })}
        </TooltipContent>
      </Tooltip>
    )
  }

  return button
}
