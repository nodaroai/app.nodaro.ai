import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { reportCommunityListing } from "@/lib/api"
import { tx, useT } from "@/lib/i18n"

const REPORT_REASONS = [
  { value: "real_person_no_consent", labelKey: "community.reasonRealPerson" },
  { value: "inappropriate", labelKey: "community.reasonInappropriate" },
  { value: "ip_violation", labelKey: "community.reasonIpViolation" },
  { value: "other", labelKey: "cat.other" },
] as const

interface ReportDialogProps {
  listingId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReportDialog({ listingId, open, onOpenChange }: ReportDialogProps) {
  const t = useT()
  const [reason, setReason] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!reason) return
    setSubmitting(true)
    try {
      await reportCommunityListing(listingId, reason)
      toast.success(tx("community.reportSubmitted"))
      setReason("")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("community.reportFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("community.reportListing")}</DialogTitle>
          <DialogDescription>
            {t("community.reportDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("community.selectReason")} />
            </SelectTrigger>
            <SelectContent>
              {REPORT_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {t(r.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!reason || submitting}>
            {submitting ? t("community.submitting") : t("community.submitReport")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
