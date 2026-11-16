import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import { queryKeys } from "@/lib/query-keys"
import { invalidateBalance } from "@/ee/lib/invalidate-balance"
import { creditUnits } from "@/lib/credit-units"
import { CONSENT_REQUIRED_EVENT } from "@/lib/consent-required-event"
import type { UserBalance } from "@/lib/api"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { collectKeys } from "@/ee/lib/ensure-signup-grant"
import { claimWelcomeOffer, markWelcomeOfferSeen, type WelcomeOfferClaimResult } from "./welcome-offer-api"
import { useWelcomeOfferStore } from "./welcome-offer-store"
import { autoShownThisVisit, markAutoShownThisVisit } from "./welcome-popup-visit"
import { formatNumber } from "@/lib/i18n/format"
import { personalFreeCreditsShown } from "@/lib/surface-selectors"

/**
 * Which welcome surface applies to this account, if any:
 *  - "offer"           — credits not claimed yet: the popup (when due) + the banner
 *  - "consent-pending" — granted through the extension, consent still owed:
 *                        the blocking banner (and the popup on a refused create)
 *  - null              — nothing to show (offer off, the account is settled, or
 *                        the deployment gives no free credits of one's own)
 */
export type WelcomeOfferMode = "offer" | "consent-pending" | null

export interface WelcomeOffer {
  mode: WelcomeOfferMode
  /**
   * The popup should open by itself now (offer mode only): the server's
   * `welcomeOffer.popupDue`, and not already opened by itself in this visit.
   */
  popupDue: boolean
  /** The server's credit figure (`welcomeOffer.credits`) in the display unit, formatted for copy; "" while there is no offer. */
  credits: string
  /** "Yes, email me & add the credits" — consent + claim in one server call. */
  claim: () => Promise<WelcomeOfferClaimResult>
  /** The popup just opened by itself: not again in this visit, and the server counts the showing. */
  markShown: () => void
  /** "Maybe later": the answer; the popup does not open by itself again. */
  answerLater: () => void
}

/**
 * The welcome-credits opt-in, derived from the balance every Cloud client
 * already polls: `welcomeOffer` is PRESENT only while the offer is switched
 * on, so an absent key is "nothing to show" without a second request.
 */
export function useWelcomeOffer(): WelcomeOffer {
  const { user } = useAuth()
  const userId = user?.id
  const queryClient = useQueryClient()
  const { data: balance } = useUserCredits(userId)
  const { surface } = useBillingSurface()

  const raw = balance?.welcomeOffer
  // An offer is only shown with the server's figure: one without a number
  // (a malformed answer) is treated as no offer, never as "0 free credits".
  const offer = raw && typeof raw.credits === "number" && Number.isFinite(raw.credits) ? raw : undefined
  // A withheld grant belongs to the first-purchase banner, whatever the
  // consent mark says: "your credits are active" would be a lie there, and
  // the server-side block stays regardless.
  //
  // A deployment that gives no free credits of one's own has no offer to make
  // (`personalFreeCreditsShown`; the server leaves the offer out under a
  // payer, and the shared header withholds it under `billing.selfServe:
  // false`). The consent ask is not an offer and stays: it is the only way out
  // of a refused create (`403 consent_required`).
  const mode: WelcomeOfferMode =
    !offer || balance?.freeGrantState === "withheld"
      ? null
      : offer.consentPending
        ? "consent-pending"
        : balance?.freeGrantState === "unclaimed" && personalFreeCreditsShown(surface.deploymentPayer)
          ? "offer"
          : null
  // The server decides when the popup opens by itself (`popupDue`: at most
  // once a day, three times in all, never after "Maybe later"). A balance from
  // a server before `popupDue` only says whether it was ever seen.
  const serverDue = offer ? (typeof offer.popupDue === "boolean" ? offer.popupDue : offer.popupSeen === false) : false
  const popupDue = mode === "offer" && serverDue && !(userId && autoShownThisVisit(userId))

  const claim = useCallback(async () => {
    const keys = await collectKeys()
    const result = await claimWelcomeOffer(keys)
    if (userId) await invalidateBalance(queryClient, userId)
    return result
  }, [queryClient, userId])

  // Not due any more, at once: the server answers the same after the post.
  const settleCachedPopup = useCallback(() => {
    if (!userId) return
    queryClient.setQueryData<UserBalance>(queryKeys.credits.balance(userId), (cur) =>
      cur?.welcomeOffer ? { ...cur, welcomeOffer: { ...cur.welcomeOffer, popupDue: false, popupSeen: true } } : cur,
    )
  }, [queryClient, userId])

  const markShown = useCallback(() => {
    if (userId) markAutoShownThisVisit(userId)
    settleCachedPopup()
    void markWelcomeOfferSeen("shown")
  }, [settleCachedPopup, userId])

  const answerLater = useCallback(() => {
    settleCachedPopup()
    void markWelcomeOfferSeen("later")
  }, [settleCachedPopup])

  // The server's figure (what a claim grants), never a local copy. Empty
  // only while there is no offer to show (mode null) — nothing renders then.
  const credits = offer ? formatNumber(creditUnits(offer.credits)) : ""

  return { mode, popupDue, credits, claim, markShown, answerLater }
}

/**
 * The CTA, shared by the popup and the banner: runs the claim, records the
 * outcome for the confirmation strip, and keeps the button available on a
 * failure so the user can retry.
 */
export function useWelcomeOfferClaim(offer: Pick<WelcomeOffer, "mode" | "claim">) {
  const setClaimed = useWelcomeOfferStore((s) => s.setClaimed)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = useCallback(async (): Promise<WelcomeOfferClaimResult | null> => {
    if (pending) return null
    setPending(true)
    setFailed(false)
    try {
      const result = await offer.claim()
      // The server recorded the yes but moved nothing (its own consent
      // re-check, or a lost race): not a success — keep the CTA up.
      if (result.grant === "unclaimed") {
        setFailed(true)
        return null
      }
      // A fresh grant gets the "credits added" strip. An extension-granted
      // account already had them — its consent just lifted the block — and a
      // withheld grant shows the first-purchase banner from the balance.
      if (offer.mode === "offer" && result.grant === "granted") setClaimed(result.credits)
      return result
    } catch {
      setFailed(true)
      return null
    } finally {
      setPending(false)
    }
  }, [offer, pending, setClaimed])

  return { run, pending, failed }
}

/** Re-render when the server refuses a creation for missing consent. */
export function useConsentAskVersion(): number {
  const version = useWelcomeOfferStore((s) => s.consentAskVersion)
  const ask = useWelcomeOfferStore((s) => s.askForConsent)
  useEffect(() => {
    window.addEventListener(CONSENT_REQUIRED_EVENT, ask)
    return () => window.removeEventListener(CONSENT_REQUIRED_EVENT, ask)
  }, [ask])
  return version
}
