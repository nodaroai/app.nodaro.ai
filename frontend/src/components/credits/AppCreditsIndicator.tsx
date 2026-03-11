import { Zap } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface AppCreditsIndicatorProps {
  userId: string
  estimatedCost: number
}

/**
 * Shows app credits allowance for free-tier users in the app runner.
 * Paid/topped-up users don't see this (all their credits work in apps).
 */
export function AppCreditsIndicator({ userId, estimatedCost }: AppCreditsIndicatorProps) {
  const { data: balance } = useUserCredits(userId)

  if (!hasCredits() || !balance) return null

  // Only show for free tier with no topup credits (paid users bypass allowance)
  if (balance.tier !== "free" || balance.topup > 0) return null

  const allowance = balance.appCreditsAllowance ?? 0
  const hasEnough = allowance >= estimatedCost

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
              hasEnough
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="font-mono">{allowance}</span>
            <span className="text-[10px] opacity-70">app CR</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {hasEnough ? (
            <p>
              You have <strong>{allowance} app credits</strong> available.
              Earned by running flows in the editor.
            </p>
          ) : (
            <p>
              You need <strong>{estimatedCost} credits</strong> to run this app
              but have <strong>{allowance} app credits</strong>.
              Earn more by running flows in the editor, or upgrade your plan.
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
