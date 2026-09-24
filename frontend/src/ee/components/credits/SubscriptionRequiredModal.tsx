"use client"

import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Sparkles } from "lucide-react"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"
import { useT } from "@/lib/i18n"

interface SubscriptionRequiredModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Shown when a pay-as-you-go account (credits without an active subscription)
 * tries to run something from the studio. Their credits stay fully usable via
 * the developer surfaces; studio access comes with any subscription.
 */
export function SubscriptionRequiredModal({ open, onClose }: SubscriptionRequiredModalProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#ff0073]" />
            {t("credits.subscriptionRequired")}
          </DialogTitle>
          <DialogDescription>
            {t("credits.subscriptionRequiredBody")}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("credits.subscriptionRequiredHint")}
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {t("connect.providerNotNow")}
          </Button>
          {surfaceBillingSelfServe() && (
            <Button asChild className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white">
              <Link to="/pricing">{t("credits.viewPlans")}</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
