"use client"

import { useEffect, useRef, useState } from "react"
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
import { TOPUP_SECTION_PATH } from "@/app/pricing/topup-anchor"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"
import { INSPECTOR_CHILD_DIALOG_Z } from "@/components/inspector/inspector-shell"
import { useAuth } from "@/hooks/use-auth"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { spendableCredits } from "@/lib/spendable-credits"
import { WelcomeOfferCard } from "@/ee/components/welcome-offer/welcome-offer-card"
import { useWelcomeOfferStore, type WelcomeClaimAnswer } from "@/ee/components/welcome-offer/welcome-offer-store"
import { FreeGrantWithheldBanner } from "./FreeGrantWithheldBanner"

interface InsufficientCreditsModalProps {
  open: boolean
  onClose: () => void
  required: number
  available: number
  tier: string
  /** Said under the figures: why `required` is more than the run's price (what its clips hold while they render). */
  note?: string
}

/**
 * First focus on the dialog's close control, never on the welcome offer's
 * "Yes": that button records marketing-email consent and claims the grant,
 * and a person who pressed a node's Run and then Enter or Space must not give
 * it by accident. Without the offer the close control already was the first
 * focus (links are skipped), so the dialog opens as it always did.
 */
function focusCloseControl(event: Event) {
  const close = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-slot="dialog-close"]')
  if (!close) return
  event.preventDefault()
  close.focus()
}

/**
 * One Escape closes this dialog and nothing under it. It opens above editors
 * that close on any Escape the document hears (the scene editor, the Kling 3
 * director); the dialog's own Escape handler runs first, on the way down, so
 * stopping the key there keeps it from reaching them. The dialog still closes.
 */
function keepEscapeHere(event: KeyboardEvent) {
  event.stopPropagation()
}

export function InsufficientCreditsModal(props: InsufficientCreditsModalProps) {
  const { open, onClose } = props
  // A welcome-offer claim's state belongs to the account that gave the "yes":
  // dropped as soon as another account (or none) is signed in, before any of
  // its dialogs could take it as its own.
  const { user } = useAuth()
  const forgetClaimsNotFor = useWelcomeOfferStore((s) => s.forgetClaimsNotFor)
  useEffect(() => {
    forgetClaimsNotFor(user?.id)
  }, [user?.id, forgetClaimsNotFor])
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      {/* Where the editor's other run dialog (the run confirmation) stacks: a
          node's Run that opens this one can be pressed from inside an editor
          that stays open over the canvas (the scene editor, the Kling 3
          director, the review inspector), and the stock z-50 would bury it. */}
      <DialogContent
        className={cn("sm:max-w-md", INSPECTOR_CHILD_DIALOG_Z)}
        overlayClassName={INSPECTOR_CHILD_DIALOG_Z}
        onOpenAutoFocus={focusCloseControl}
        onEscapeKeyDown={keepEscapeHere}
      >
        {/* The content unmounts while the dialog is closed, so what one opening
            learned (a "yes" to the welcome credits, a failed try) never
            carries over into the next. */}
        <InsufficientCreditsBody {...props} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * After a "yes" to the welcome credits given in this dialog: the grant landed
 * and still leaves the run short (with the balance read back), or it was
 * withheld.
 */
type AfterClaim = { readonly grant: "granted"; readonly available: number } | { readonly grant: "withheld" }

function InsufficientCreditsBody({
  onClose,
  required,
  available,
  tier,
  note,
}: InsufficientCreditsModalProps) {
  const t = useT()
  const [afterClaim, setAfterClaim] = useState<AfterClaim | null>(null)
  const { user } = useAuth()
  const userId = user?.id
  // The account this opening's refusal belongs to (the first one known). A
  // dialog opened for one account's refusal is not another's: if the
  // signed-in account changes while it is open, it closes, and in the
  // meantime takes no answer and no balance of the new account's.
  const openedFor = useRef(userId)
  if (openedFor.current === undefined) openedFor.current = userId
  const accountChanged = openedFor.current !== undefined && userId !== openedFor.current
  // A claim's answer belongs to the account, not to the opening that gave the
  // "yes": this dialog applies every answer that lands while it is open — its
  // own, or one from an earlier opening still on its way — against its own
  // figures. One recorded before it opened is not its own: the refusal that
  // opened it already counts it.
  const lastAnswer = useWelcomeOfferStore((s) => s.lastClaimAnswer)
  const appliedSeq = useRef(useWelcomeOfferStore.getState().claimAnswerSeq)
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
  // The account's balance as the app keeps reading it (the same query the
  // offer reads): only a balance that says the grant happened is a figure
  // this dialog may take after a claim.
  const { data: liveBalance } = useUserCredits(userId)
  const liveGranted = !accountChanged && liveBalance?.freeGrantState === "granted" ? spendableCredits(liveBalance, deploymentPayer).figure : null
  // Two independent switches. A prepaid instance (self-serve purchase off) is
  // NOT a payer instance — it already withheld the CTAs, and it must not start
  // rendering allowance copy that does not apply to it.
  const showPurchase = surfaceBillingSelfServe() && !deploymentPayer

  // The figures are the ones that refused the run, until a "yes" here granted
  // the welcome credits: then the balance the claim read back.
  const shownAvailable = afterClaim?.grant === "granted" ? afterClaim.available : available
  const shortage = Math.max(0, required - shownAvailable)

  function applyAnswer(answer: WelcomeClaimAnswer) {
    if (answer.grant === "withheld") {
      setAfterClaim({ grant: "withheld" })
      return
    }
    // The grant raises the plan credits TO its amount (the server keeps the
    // greater of the two) and the claim answers that amount even when nothing
    // moved, so it is never added on top. A read-back that already says
    // granted is the balance as it is; without one (it failed, or came back
    // from before the grant) the most that can be said is the greater of what
    // refused the run and the grant. RAW credits on every side, as the check
    // that refused the run compared them.
    const granted = Number.isFinite(answer.credits) ? answer.credits : 0
    const now = answer.readBack ?? Math.max(available, granted)
    // Covered now: the dialog closes and the person presses Run again —
    // nothing is started for them. An answer never closes a dialog whose own
    // run it does not cover.
    if (now >= required) {
      onClose()
      return
    }
    setAfterClaim({ grant: "granted", available: now })
  }

  // Another account (or none) is signed in now: this refusal is not theirs.
  useEffect(() => {
    if (accountChanged) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountChanged])

  useEffect(() => {
    if (accountChanged || !lastAnswer || lastAnswer.userId !== userId || lastAnswer.seq <= appliedSeq.current) return
    appliedSeq.current = lastAnswer.seq
    applyAnswer(lastAnswer)
    // Applied once per answer, against this opening's figures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAnswer, userId])

  // After a granted answer, the dialog follows the balance: once one arrives
  // that says the grant happened, its figure replaces whatever the dialog had
  // to show (the lower bound, when the read-back failed or came back stale),
  // and the dialog closes when its own run is now covered. A balance that
  // does not say "granted" yet moves nothing, and before a claim was answered
  // the dialog never follows the balance at all.
  useEffect(() => {
    if (afterClaim?.grant !== "granted" || liveGranted === null) return
    if (liveGranted >= required) {
      onClose()
      return
    }
    if (liveGranted !== afterClaim.available) setAfterClaim({ grant: "granted", available: liveGranted })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveGranted, afterClaim])

  return (
    <>
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
                available: creditUnits(shownAvailable),
              })}
        </DialogDescription>
        {note && <p className="text-xs text-muted-foreground" data-testid="insufficient-credits-note">{note}</p>}
      </DialogHeader>

      {/* The welcome credits the account never claimed, offered again on top
          (only while they are unclaimed: `WelcomeOfferCard` renders nothing
          otherwise). Once a "yes" here is answered the card goes; a withheld
          grant gets the sentence the product says for one in its place. */}
      {afterClaim === null && <WelcomeOfferCard />}
      {/* From the claim's answer: the sentence shows without waiting for the
          balance to say the grant was withheld. */}
      {afterClaim?.grant === "withheld" && <FreeGrantWithheldBanner className="rounded-lg border" grantWithheld />}

      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t("credits.currentBalanceLabel")}</p>
            <p className="text-lg font-semibold font-mono">{formatNumber(creditUnits(shownAvailable))}</p>
          </div>
          {/* Logical end, not `right`: this pair mirrors under RTL and the
              deployment this ships to is Hebrew-default. */}
          <div className="space-y-1 text-end">
            <p className="text-sm text-muted-foreground">{t("credits.requiredLabel")}</p>
            <p className="text-lg font-semibold font-mono text-destructive">{formatNumber(creditUnits(required))}</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("credits.shortByLabel")}</span>
          <span className="font-medium font-mono">
            {t("credits.shortByAmount", { n: formatNumber(creditUnits(shortage)) })}
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
            <a href={TOPUP_SECTION_PATH}>
              <CreditCard className="w-4 h-4" />
              {t("credits.buyCreditsCta")}
            </a>
          </Button>
        </DialogFooter>
      )}
    </>
  )
}
