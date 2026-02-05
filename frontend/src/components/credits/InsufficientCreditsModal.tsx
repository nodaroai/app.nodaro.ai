"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { AlertCircle } from "lucide-react"

interface Props {
  isOpen: boolean
  onClose: () => void
  required: number
  balance: number
  error?: string
}

export function InsufficientCreditsModal({
  isOpen,
  onClose,
  required,
  balance,
  error,
}: Props) {
  const shortage = Math.max(0, required - balance)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            Insufficient Credits
          </DialogTitle>
          <DialogDescription>
            {error ||
              `You need ${required} credits but only have ${balance} available.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {shortage > 0 && (
            <div className="p-4 bg-muted rounded-md">
              <p className="text-sm">
                <span className="font-medium">Short by:</span> {shortage}{" "}
                credits
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button asChild className="flex-1">
              <a href="/pricing">Upgrade Plan</a>
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <a href="/credits/buy">Buy Credits</a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
