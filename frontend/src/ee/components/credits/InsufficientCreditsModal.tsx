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
  const shortage = Math.max(0, required - available)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            Insufficient Credits
          </DialogTitle>
          <DialogDescription>
            You need {required} credits but only have {available} available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Current balance</p>
              <p className="text-lg font-semibold font-mono">{available.toLocaleString()}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-sm text-muted-foreground">Required</p>
              <p className="text-lg font-semibold font-mono text-destructive">{required.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Short by</span>
            <span className="font-medium font-mono">{shortage.toLocaleString()} credits</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current plan</span>
            <Badge variant="secondary" className="capitalize">{tier}</Badge>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button asChild className="flex-1">
            <a href="/pricing">
              <ArrowUpCircle className="w-4 h-4" />
              Upgrade Plan
            </a>
          </Button>
          <Button variant="outline" asChild className="flex-1">
            <a href="/credits/buy">
              <CreditCard className="w-4 h-4" />
              Buy Credits
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
