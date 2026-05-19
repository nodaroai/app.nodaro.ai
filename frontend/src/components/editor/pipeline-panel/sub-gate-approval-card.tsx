import { useState, type ReactNode } from "react"
import type { SubGateName } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * Phase 1C.2 — shared approve/reject state machine for Stage 7 sub-gates
 * (`silent_cut_preview`, `dialogue_recheck`). Owns the in-flight flag, the
 * reject Dialog with Textarea, and the API mutations. Per-gate components
 * supply the unique body via `children` plus a few presentational props.
 *
 * Both call sites pre-extraction owned the same 30-ish lines of state +
 * handler boilerplate — the only meaningful difference was the preview/grid
 * inside CardContent and the approve-button label.
 */

interface SubGateApprovalCardProps {
  readonly pipelineId: string
  readonly gate: SubGateName
  /** Card heading title. */
  readonly title: string
  /** Optional subtitle/description rendered under the title. */
  readonly description?: ReactNode
  /** Label on the approve button. */
  readonly approveLabel: string
  /** Title shown on the reject confirmation dialog. */
  readonly rejectTitle: string
  /** Placeholder for the feedback textarea inside the reject dialog. */
  readonly rejectPlaceholder?: string
  /** Optional extra className on the outer Card (e.g. amber theme). */
  readonly className?: string
  /** Test id forwarded to the outer Card. */
  readonly cardTestId?: string
  /** Variant for the reject button trigger. Some banners use plain outline
   *  (matches the warning-themed card), others use destructive. */
  readonly rejectButtonVariant?: "outline" | "destructive"
  /** The body — preview video, rebalance grid, etc. */
  readonly children: ReactNode
}

export function SubGateApprovalCard({
  pipelineId,
  gate,
  title,
  description,
  approveLabel,
  rejectTitle,
  rejectPlaceholder,
  className,
  cardTestId,
  rejectButtonVariant = "destructive",
  children,
}: SubGateApprovalCardProps) {
  const [isRejectOpen, setIsRejectOpen] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    if (inFlight) return
    setInFlight(true)
    setError(null)
    try {
      await pipelinesApi.approveSubGate(pipelineId, gate)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed")
    } finally {
      setInFlight(false)
    }
  }

  async function handleConfirmReject() {
    if (inFlight) return
    setInFlight(true)
    setError(null)
    try {
      await pipelinesApi.rejectSubGate(
        pipelineId,
        gate,
        feedback.trim() || undefined,
      )
      setIsRejectOpen(false)
      setFeedback("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rejection failed")
    } finally {
      setInFlight(false)
    }
  }

  return (
    <Card data-testid={cardTestId} className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? (
          typeof description === "string" ? (
            <CardDescription>{description}</CardDescription>
          ) : (
            description
          )
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {error && (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <Button
            variant={rejectButtonVariant}
            onClick={() => setIsRejectOpen(true)}
            disabled={inFlight}
          >
            Reject
          </Button>
          <Button onClick={handleApprove} disabled={inFlight}>
            {approveLabel}
          </Button>
        </div>
      </CardContent>

      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rejectTitle}</DialogTitle>
            <DialogDescription>
              The stage will fail and credits will be refunded. Optional
              feedback helps when re-running.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={rejectPlaceholder}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRejectOpen(false)}
              disabled={inFlight}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReject}
              disabled={inFlight}
            >
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
