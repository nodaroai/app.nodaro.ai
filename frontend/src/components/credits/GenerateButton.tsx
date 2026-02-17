import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Loader2 } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { useModelCreditCost, useUserCredits } from "@/hooks/queries/use-credits-queries"

interface GenerateButtonProps {
  onClick: () => void
  disabled?: boolean
  isRunning?: boolean
  modelIdentifier: string
  userId: string
  label?: string
  children?: React.ReactNode
}

export function GenerateButton({
  onClick,
  disabled = false,
  isRunning = false,
  modelIdentifier,
  userId,
  label = "Generate",
  children,
}: GenerateButtonProps) {
  const { data: creditCost } = useModelCreditCost(modelIdentifier)
  const { data: balance } = useUserCredits(userId)

  const creditsActive = hasCredits()
  const totalBalance = balance?.total ?? 0
  const insufficient = creditsActive && creditCost != null && creditCost > 0 && totalBalance < creditCost

  const showCreditInfo = creditsActive && creditCost != null && creditCost > 0

  const buttonContent = (
    <>
      {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
      {isRunning ? "Processing..." : (children ?? label)}
      {showCreditInfo && !isRunning && (
        <span className="ml-1 opacity-80">
          ({creditCost} {creditCost === 1 ? "credit" : "credits"})
        </span>
      )}
    </>
  )

  const button = (
    <Button
      onClick={onClick}
      disabled={disabled || isRunning || insufficient}
      className="w-full"
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
          Insufficient credits (need {creditCost}, have {totalBalance})
        </TooltipContent>
      </Tooltip>
    )
  }

  return button
}
