"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Loader2 } from "lucide-react"
import { getModelCreditCost } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/components/credits/CreditBalance"

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
  const [creditCost, setCreditCost] = useState<number | null>(null)
  const { balance } = useUserCredits(userId)

  const creditsActive = hasCredits()
  const totalBalance = balance?.total ?? 0
  const insufficient = creditsActive && creditCost !== null && creditCost > 0 && totalBalance < creditCost

  useEffect(() => {
    if (!creditsActive || !modelIdentifier) return

    let cancelled = false
    async function fetchCost() {
      try {
        const result = await getModelCreditCost(modelIdentifier)
        const data = result.data ?? (result as unknown as { model: string; creditCost: number })
        if (!cancelled) {
          setCreditCost(data.creditCost)
        }
      } catch {
        if (!cancelled) {
          setCreditCost(null)
        }
      }
    }

    fetchCost()
    return () => { cancelled = true }
  }, [modelIdentifier, creditsActive])

  const showCreditInfo = creditsActive && creditCost !== null && creditCost > 0

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
