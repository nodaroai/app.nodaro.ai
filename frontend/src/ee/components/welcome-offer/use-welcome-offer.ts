import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { queryKeys } from "@/lib/query-keys"
import { FREE_TIER_CREDITS } from "@/lib/pricing-data"
import { creditUnits } from "@/lib/credit-units"
import { CONSENT_REQUIRED_EVENT } from "@/lib/consent-required-event"
import type { UserBalance } from "@/lib/api"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { collectKeys } from "@/ee/lib/ensure-signup-grant"
import { claimWelcomeOffer, markWelcomeOfferSeen, type WelcomeOfferClaimResult } from "./welcome-offer-api"
import { useWelcomeOfferStore } from "./welcome-offer-store"
import { formatNumber } from "@/lib/i18n/format"

/**
 * Which welcome surface applies to this account, if any:
 *  - "offer"           — credits not claimed yet: the popup (once) + the banner
 *  - "consent-pending" — granted through the extension, consent still owed:
 *                        the blocking banner (and the popup on a refused create)
 *  - null              — nothing to show (offer off, or the account is settled)
 */
export type WelcomeOfferMode = "offer" | "consent-pending" | null

export interface WelcomeOffer {
  mode: WelcomeOfferMode
  /** The popup has not been shown to this account yet (offer mode only). */
  popupDue: boolean
  /** The credit figure in the display unit, formatted for copy. */
  credits: string
  /** "Yes, email me & add the credits" — consent + claim in one server call. */
  claim: () => Promise<WelcomeOfferClaimResult>
  /** The popup was shown; never show it again. */
  markSeen: () => void
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

  const offer = balance?.welcomeOffer
  // A withheld grant belongs to the card-activation banner, whatever the
  // consent mark says: "your credits are active" would be a lie there, and
  // the server-side block stays regardless.
  const mode: WelcomeOfferMode =
    !offer || balance?.freeGrantState === "withheld"
      ? null
      : offer.consentPending
        ? "consent-pending"
        : balance?.freeGrantState === "unclaimed"
          ? "offer"
          : null
  const popupDue = mode === "offer" && offer?.popupSeen === false

  const claim = useCallback(async () => {
    const keys = await collectKeys()
    const result = await claimWelcomeOffer(keys)
    if (userId) await queryClient.invalidateQueries({ queryKey: queryKeys.credits.balance(userId) })
    return result
  }, [queryClient, userId])

  const markSeen = useCallback(() => {
    if (userId) {
      queryClient.setQueryData<UserBalance>(queryKeys.credits.balance(userId), (cur) =>
        cur?.welcomeOffer ? { ...cur, welcomeOffer: { ...cur.welcomeOffer, popupSeen: true } } : cur,
      )
    }
    void markWelcomeOfferSeen()
  }, [queryClient, userId])

  return { mode, popupDue, credits: formatNumber(creditUnits(FREE_TIER_CREDITS)), claim, markSeen }
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
      // withheld grant shows the card-activation banner from the balance.
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
