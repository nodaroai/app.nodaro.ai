import { useState } from "react"
import { Zap } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { GetCreditsModal } from "./GetCreditsModal"

interface AppCreditsIndicatorProps {
  userId: string
  estimatedCost: number
}

/**
 * Shows app credits allowance for free-tier users in the app runner.
 * Clickable — opens GetCreditsModal.
 * Paid/topped-up users don't see this (all their credits work in apps).
 */
export function AppCreditsIndicator({ userId, estimatedCost }: AppCreditsIndicatorProps) {
  const { data: balance } = useUserCredits(userId)
  const [showModal, setShowModal] = useState(false)

  if (!hasCredits() || !balance) return null

  // Only show for free tier with no topup credits (paid users bypass allowance)
  if (balance.tier !== "free" || balance.topup > 0) return null

  const allowance = balance.appCreditsAllowance ?? 0
  const hasEnough = allowance >= estimatedCost

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                allowance > 0
                  ? hasEnough
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
                  : "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/20 hover:bg-[#ff0073]/20"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              {allowance > 0 ? (
                <>
                  <span className="font-mono">{allowance}</span>
                  <span className="text-[10px] opacity-70">app CR</span>
                </>
              ) : (
                <span>Get Credits</span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            {allowance > 0 ? (
              hasEnough ? (
                <p>
                  You have <strong>{allowance} app credits</strong> available.
                  Earned by running flows in the editor. Click to get more.
                </p>
              ) : (
                <p>
                  You need <strong>{estimatedCost} credits</strong> to run this app
                  but have <strong>{allowance} app credits</strong>.
                  Click to get more credits.
                </p>
              )
            ) : (
              <p>
                You need credits to run this app.
                Click to subscribe, buy credits, or learn how to earn free credits.
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <GetCreditsModal
        open={showModal}
        onClose={() => setShowModal(false)}
        tier={balance.tier}
        balance={balance.total}
        required={estimatedCost}
        appCreditsAllowance={allowance}
      />
    </>
  )
}
