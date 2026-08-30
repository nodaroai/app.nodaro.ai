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
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#ff0073]" />
            Subscription required
          </DialogTitle>
          <DialogDescription>
            Your credits are available through the API, SDK and MCP. Working in
            the studio requires a subscription.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Your credit balance is untouched — keep building with it
          programmatically, or pick a plan to unlock the studio and every other
          Nodaro app.
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          {surfaceBillingSelfServe() && (
            <Button asChild className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white">
              <Link to="/pricing">View plans</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
