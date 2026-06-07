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

const REPORT_REASONS = [
  { value: "real_person_no_consent", label: "Depicts a real person without consent" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "ip_violation", label: "IP violation" },
  { value: "other", label: "Other" },
] as const

interface ReportDialogProps {
  listingId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReportDialog({ listingId, open, onOpenChange }: ReportDialogProps) {
  const [reason, setReason] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!reason) return
    setSubmitting(true)
    try {
      await reportCommunityListing(listingId, reason)
      toast.success("Report submitted. Thank you.")
      setReason("")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit report")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report listing</DialogTitle>
          <DialogDescription>
            Let us know why you&apos;re reporting this listing. Our team will review it.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
            <SelectContent>
              {REPORT_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!reason || submitting}>
            {submitting ? "Submitting…" : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
