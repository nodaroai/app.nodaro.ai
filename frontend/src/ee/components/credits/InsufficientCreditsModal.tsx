"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, ArrowUpCircle, CreditCard } from "lucide-react"
import { creditUnits } from "@/lib/credit-units"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import { useT } from "@/lib/i18n"

interface InsufficientCreditsModalProps {
  open: boolean
  onClose: () => void
  required: number
  available: number
  tier: string
}

export function InsufficientCreditsModal({
  open,
  onClose,
  required,
  available,
  tier,
}: InsufficientCreditsModalProps) {
  const t = useT()
  const shortage = Math.max(0, required - available)
  // Track A (D12) — this deployment has ONE account that pays for everything,
  // and the person reading this is not it. Both CTAs below are lies here: its
  // users cannot buy the platform's credits, and no admin can top anyone up
  // (decision 5). The only fixer is the billing account, so that is what the
  // card says instead — D10's copy, in the reader's language.
  //
  // Fails OPEN: the surface is fetched, and `deploymentPayer` is false until
  // it answers. Defaulting the other way would hide a real purchase path from
  // a paying mainline customer for the length of one request.
  const { surface } = useBillingSurface()
  const deploymentPayer = surface.deploymentPayer === true
  // Two independent switches. A prepaid instance (self-serve purchase off) is
  // NOT a payer instance — it already withheld the CTAs, and it must not start
  // rendering allowance copy that does not apply to it.
  const showPurchase = surfaceBillingSelfServe() && !deploymentPayer

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            {t("credits.insufficientTitle")}
          </DialogTitle>
          <DialogDescription>
            {deploymentPayer
              ? t("credits.allowanceExceeded")
              : t("credits.insufficientDescription", {
                  required: creditUnits(required),
                  available: creditUnits(available),
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t("credits.currentBalanceLabel")}</p>
              <p className="text-lg font-semibold font-mono">{creditUnits(available).toLocaleString()}</p>
            </div>
            {/* Logical end, not `right`: this pair mirrors under RTL and the
                deployment this ships to is Hebrew-default. */}
            <div className="space-y-1 text-end">
              <p className="text-sm text-muted-foreground">{t("credits.requiredLabel")}</p>
              <p className="text-lg font-semibold font-mono text-destructive">{creditUnits(required).toLocaleString()}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("credits.shortByLabel")}</span>
            <span className="font-medium font-mono">
              {t("credits.shortByAmount", { n: creditUnits(shortage).toLocaleString() })}
            </span>
          </div>

          {/* A billing tier is a self-serve concept: under a deployment payer
              the pool belongs to someone else, and the reader's "plan" is not
              something they have or can change. */}
          {!deploymentPayer && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("credits.currentPlanLabel")}</span>
              <Badge variant="secondary" className="capitalize">{tier}</Badge>
            </div>
          )}
        </div>

        {/* Both CTAs sell the platform's credits — withheld on a deployment
            without self-serve purchase (a prepaid instance), and on one whose
            users spend a payer's pool (Track A). */}
        {showPurchase && (
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button asChild className="flex-1">
              <a href="/pricing">
                <ArrowUpCircle className="w-4 h-4" />
                {t("credits.upgradePlanCta")}
              </a>
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <a href="/credits/buy">
                <CreditCard className="w-4 h-4" />
                {t("credits.buyCreditsCta")}
              </a>
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
