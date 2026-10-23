import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { ArrowRight, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { WelcomeCreditBadge } from "./welcome-credit-badge"
import { useConsentAskVersion, useWelcomeOffer, useWelcomeOfferClaim } from "./use-welcome-offer"
import { whenActivated } from "@/lib/prerender"

/** The home (Continue) tab — the only place the popup opens on its own. */
const HOME_PATH = "/projects"

/**
 * The first-visit credits popup: shown ONCE per account, above the home
 * screen, until the user claims or closes it. Closing (×, "Maybe later", the
 * scrim) stamps it as seen — it never returns; the banner stays.
 *
 * It also serves an extension-granted account that still owes its consent:
 * a refused creation (`403 consent_required`) reopens it with the ask, on
 * whatever page the refusal happened.
 *
 * Cloud-only: mounted through `WelcomeOfferPopupSlot`. Renders nothing while
 * the offer is off or the account is settled.
 */
export function WelcomeOfferPopup() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { pathname } = useLocation()
  const offer = useWelcomeOffer()
  const { run, pending, failed } = useWelcomeOfferClaim(offer)
  const askVersion = useConsentAskVersion()
  const [open, setOpen] = useState(false)
  const autoOpened = useRef(false)

  // First visit: open once, on the home screen, while the popup is still due.
  useEffect(() => {
    if (!offer.popupDue || pathname !== HOME_PATH || autoOpened.current) return
    // Never from a prerendered page nobody has seen yet (lib/prerender.ts).
    return whenActivated(() => {
      if (autoOpened.current) return
      autoOpened.current = true
      setOpen(true)
    })
  }, [offer.popupDue, pathname])

  // The server refused a creation for missing consent — ask right here.
  useEffect(() => {
    if (askVersion > 0 && offer.mode === "consent-pending") setOpen(true)
  }, [askVersion, offer.mode])

  if (!offer.mode) return null

  const pendingConsent = offer.mode === "consent-pending"
  const params = { credits: offer.credits }

  function close() {
    setOpen(false)
    if (offer.mode === "offer") offer.markSeen()
  }

  async function claim() {
    const result = await run()
    if (result) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[var(--welcome-scrim)] backdrop-blur-[6px]"
        className="w-[min(460px,calc(100%-2rem))] max-w-none gap-0 overflow-hidden rounded-[22px] border-0 bg-[linear-gradient(150deg,var(--welcome-accent),rgba(108,92,255,0.7)_55%,var(--welcome-accent))] p-px shadow-[var(--welcome-popup-shadow)] sm:max-w-none"
      >
        <div className="welcome-glow relative rounded-[21px] bg-[var(--welcome-panel)] px-8 pb-7 pt-9 text-center">
          <button
            type="button"
            aria-label={t("welcome.close")}
            onClick={close}
            className="absolute end-3 top-3 rounded-md p-1.5 text-[var(--welcome-muted)] transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <WelcomeCreditBadge credits={offer.credits} size="lg" />

          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--welcome-accent)]">
            {t("welcome.eyebrow")}
          </p>
          <DialogTitle className="mt-2 text-[26px] font-extrabold leading-tight text-foreground">
            {pendingConsent ? t("welcome.pending.title", params) : t("welcome.title", params)}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-3 max-w-[360px] text-sm leading-relaxed text-[var(--welcome-fg2)]">
            {pendingConsent ? t("welcome.pending.body") : t("welcome.body")}
          </DialogDescription>

          <Button
            onClick={claim}
            disabled={pending}
            className="mt-6 h-12 w-full max-w-[380px] rounded-full bg-[var(--welcome-accent)] px-6 text-[15px] font-bold text-white shadow-[0_10px_30px_rgba(255,42,127,0.35)] hover:bg-[var(--welcome-accent)] hover:brightness-110"
          >
            {pendingConsent ? t("welcome.pending.cta") : t("welcome.cta", params)}
            <ArrowRight className={cn("ms-1 h-4 w-4", isRtl && "rotate-180")} />
          </Button>
          {failed && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {t("welcome.error")}
            </p>
          )}

          {!pendingConsent && (
            <button
              type="button"
              onClick={close}
              className="mt-4 text-sm font-medium text-[var(--welcome-muted)] underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("welcome.later")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
