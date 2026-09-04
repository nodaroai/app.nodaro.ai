import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Loader2 } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import { RUN_BUTTON_CLASS } from "@/lib/run-button-style"
import { useModelCreditCost, useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { creditUnits } from "@/lib/credit-units"
import { spendableCredits } from "@/lib/spendable-credits"
import { useBillingSurface } from "@/hooks/use-billing-surface"

interface GenerateButtonProps {
  onClick: () => void
  disabled?: boolean
  /** Tooltip explaining why `disabled` is set (unmet precondition). Rendered
   *  through the same Tooltip wrapper the insufficient-credits case uses. */
  disabledReason?: string
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
  disabledReason,
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
  // Track A (D12, ruling R-A) — the gate figure, not `total`, and only when a
  // client gate is entitled to run at all.
  //
  // This is the MAIN generate action on a payer instance and
  // `handleRunSingleNode` has no balance pre-check behind it, so the disabled
  // button IS the refusal — which is exactly why it must not refuse on a
  // number nothing debits. On a payer instance `total` is the requester's
  // FROZEN signup grant, so the billing account could grant a user 10,000
  // credits, watch the sidebar show them, and still find this button disabled
  // for a 4,000-credit node quoting a 1,500 it cannot move; a user provisioned
  // before any signup grant landed (`total: 0`) got a dead button outright.
  //
  // So on a payer instance this button gates ONLY on an allowance the server
  // says it enforces: while one is visible-but-unenforced, and while one is
  // null (the payer itself, or a read that failed), `gateApplies` is false and
  // the server refuses if the pool cannot cover the run. Mainline and an
  // enforced allowance gate exactly as before.
  // Does this DEPLOYMENT have a payer (not "am I the payer")? It decides how a
  // `null` allowance reads — the payer's own exemption (D13) or a figure the
  // server could not read, indistinguishable in the body, and on a payer
  // instance neither is licence to refuse on the frozen grant. Deployment-grain
  // and long-cached, so this costs no request the page has not already made.
  const { surface } = useBillingSurface()
  const spendableFor = balance ? spendableCredits(balance, surface.deploymentPayer === true) : null
  const spendable = spendableFor?.figure ?? 0
  // No balance yet is not the pre-flip window: it keeps today's behaviour,
  // where a cost with no known balance holds the button until the query lands.
  const gateApplies = spendableFor?.gateApplies ?? true
  const insufficient =
    creditsActive && gateApplies && totalCost != null && totalCost > 0 && spendable < totalCost

  const showCreditInfo = creditsActive && totalCost != null && totalCost > 0
  // Display unit (Phase B): the gate above compares RAW credits; only what is
  // shown converts.
  const shownCost = creditUnits(totalCost)

  const buttonContent = (
    <>
      {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
      {isRunning ? t("credits.processing") : (children ?? label ?? t("credits.generate"))}
      {showCreditInfo && !isRunning && (
        <span className="ml-1 opacity-80">
          {t("credits.amount", {
            n: shownCost,
            unit: shownCost === 1 ? t("credits.unit.one") : t("credits.unit.other"),
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
          {/* The SAME number the gate used — a tooltip that names a different
              balance than the one that disabled the button teaches the user to
              trust neither. */}
          {t("credits.insufficientTooltip", { need: shownCost, have: creditUnits(spendable) })}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="w-full">{button}</span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    )
  }

  return button
}
