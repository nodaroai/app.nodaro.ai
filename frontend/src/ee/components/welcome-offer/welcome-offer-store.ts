import { create } from "zustand"

/**
 * The server's answer to a "yes" given in the not-enough-credits dialog, kept
 * for the account it belongs to. `seq` grows with every answer, so a dialog
 * applies only the answers that land while it is open. `readBack` is the
 * balance the app read back after the claim (RAW credits), only when that read
 * already says the grant happened (fresh); null otherwise.
 */
export interface WelcomeClaimAnswer {
  readonly userId: string
  readonly seq: number
  readonly grant: "granted" | "withheld"
  /** The grant's amount, as the claim answered it (it raises the plan credits TO this, never adds it on top). */
  readonly credits: number
  readonly readBack: number | null
}

/**
 * The bits of welcome-offer state that cross components.
 *
 * `claimedCredits` — set by whichever surface (the popup, the banner, or the
 * offer in the not-enough-credits dialog) completed a successful claim, all
 * through `useWelcomeOfferClaim`; the banner slot then shows the one-time
 * "credits added" strip until "Done". Session-local on purpose: the design shows it once,
 * and the server already knows the account is granted.
 *
 * `consentAskVersion` — bumped when the server refuses a creation with
 * `consent_required` (an extension-granted account that has not consented);
 * the popup opens with the ask wherever the refusal happened.
 *
 * `claimInFlightFor` and `lastClaimAnswer` — a "yes" given in the
 * not-enough-credits dialog belongs to the ACCOUNT, not to the opening that
 * started it: the dialog's content unmounts when it closes, and a claim can
 * outlive it. While one is out, no opening offers a second live "yes"; its
 * answer is applied by whichever dialog is open when it lands, against that
 * dialog's own figures (`WelcomeOfferCard`, `InsufficientCreditsModal`). Both
 * are dropped when the signed-in account changes (`forgetClaimsNotFor`).
 */
interface WelcomeOfferState {
  claimedCredits: number | null
  consentAskVersion: number
  claimInFlightFor: string | null
  lastClaimAnswer: WelcomeClaimAnswer | null
  /** How many answers were ever recorded: never reset, so a dialog can tell the answers that land while it is open. */
  claimAnswerSeq: number
  setClaimed: (credits: number) => void
  dismissClaimed: () => void
  askForConsent: () => void
  setClaimInFlightFor: (userId: string | null) => void
  recordClaimAnswer: (answer: Omit<WelcomeClaimAnswer, "seq">) => void
  /** Drop a claim's state that belongs to any account but `userId` (signed out: none is kept). */
  forgetClaimsNotFor: (userId: string | undefined) => void
}

export const useWelcomeOfferStore = create<WelcomeOfferState>((set) => ({
  claimedCredits: null,
  consentAskVersion: 0,
  claimInFlightFor: null,
  lastClaimAnswer: null,
  claimAnswerSeq: 0,
  setClaimed: (credits) => set({ claimedCredits: credits }),
  dismissClaimed: () => set({ claimedCredits: null }),
  askForConsent: () => set((s) => ({ consentAskVersion: s.consentAskVersion + 1 })),
  setClaimInFlightFor: (userId) => set({ claimInFlightFor: userId }),
  recordClaimAnswer: (answer) => set((s) => ({ claimAnswerSeq: s.claimAnswerSeq + 1, lastClaimAnswer: { ...answer, seq: s.claimAnswerSeq + 1 } })),
  forgetClaimsNotFor: (userId) =>
    set((s) => ({
      claimInFlightFor: s.claimInFlightFor !== null && s.claimInFlightFor !== userId ? null : s.claimInFlightFor,
      lastClaimAnswer: s.lastClaimAnswer !== null && s.lastClaimAnswer.userId !== userId ? null : s.lastClaimAnswer,
    })),
}))
