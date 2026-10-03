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
import { HardDrive, ArrowUpCircle, FolderOpen } from "lucide-react"
import { surfaceBillingSelfServe } from "@/lib/surface-selectors"
import { useT } from "@/lib/i18n"

interface StorageExceededModalProps {
  open: boolean
  onClose: () => void
  usedBytes: number
  quotaBytes: number
  tier: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function StorageExceededModal({
  open,
  onClose,
  usedBytes,
  quotaBytes,
  tier,
}: StorageExceededModalProps) {
  const t = useT()
  const usagePercent = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 100
  const remainingBytes = Math.max(0, quotaBytes - usedBytes)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-destructive" />
            {t("credits.storageLimitReached")}
          </DialogTitle>
          <DialogDescription>
            {t("credits.storageFullBody")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t("credits.storageUsed")}</p>
              <p className="text-lg font-semibold font-mono">{formatBytes(usedBytes)}</p>
            </div>
            <div className="space-y-1 text-end">
              <p className="text-sm text-muted-foreground">{t("credits.storageQuota")}</p>
              <p className="text-lg font-semibold font-mono">{formatBytes(quotaBytes)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("credits.storagePercentUsed", { n: usagePercent })}</span>
              <span>{t("credits.storageRemaining", { size: formatBytes(remainingBytes) })}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${usagePercent}%`,
                  backgroundColor: usagePercent >= 90 ? "#ef4444" : usagePercent >= 70 ? "#f59e0b" : "#3b82f6",
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("credits.currentPlanLabel")}</span>
            <Badge variant="secondary" className="capitalize">{tier}</Badge>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {surfaceBillingSelfServe() && (
            <Button asChild className="flex-1">
              <a href="/pricing">
                <ArrowUpCircle className="w-4 h-4" />
                {t("credits.upgradePlanCta")}
              </a>
            </Button>
          )}
          <Button variant="outline" asChild className="flex-1">
            <a href="/my-files">
              <FolderOpen className="w-4 h-4" />
              {t("credits.manageFiles")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
