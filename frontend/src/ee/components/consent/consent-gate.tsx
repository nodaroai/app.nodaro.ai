import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { tx, useT } from "@/lib/i18n"
import { fetchConsentState, grantConsent, declineConsent, SOURCE_APP } from "./consent-api"

type View = "hidden" | "card" | "confirmed"

/**
 * The marketing-email consent prompt — a dismissible bottom-right card (never a
 * blocking modal; the product stays fully usable). Cloud-only: it is only
 * mounted through `ConsentGateSlot`, which gates on `hasCredits()`.
 *
 * The server decides whether to show it (cadence + lifetime cap live in the
 * `consent_try_show` RPC); this component just renders the answer and posts the
 * user's choice. Dismissing (the X) closes it with no write — the server
 * already counted the show, so it re-appears next time per the cadence.
 */
export function ConsentGate() {
  const t = useT()
  const [view, setView] = useState<View>("hidden")
  const [body, setBody] = useState("")
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchConsentState().then((s) => {
      if (cancelled) return
      if (s.shouldShow) {
        setBody(s.text ?? "")
        setView("card")
      }
    })
    return () => {
      cancelled = true
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  async function answer(kind: "grant" | "decline") {
    if (pending) return
    setPending(true)
    try {
      if (kind === "grant") {
        await grantConsent(SOURCE_APP)
        setNote(tx("consent.onTheList"))
      } else {
        await declineConsent()
        setNote(tx("consent.noProblem"))
      }
      setView("confirmed")
      closeTimer.current = setTimeout(() => setView("hidden"), 2200)
    } catch {
      // A failed write just means they'll be asked again next time — keep the
      // card up so they can retry rather than swallowing their choice.
      setPending(false)
    }
  }

  if (view === "hidden") return null

  return (
    <div
      role="dialog"
      aria-label={t("consent.emailUpdatesAria")}
      className="fixed bottom-5 end-5 z-50 w-[372px] max-w-[calc(100vw-2.5rem)] rounded-2xl border bg-card text-card-foreground shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      {view === "card" ? (
        <div className="p-5">
          <button
            type="button"
            aria-label={t("consent.dismiss")}
            onClick={() => setView("hidden")}
            className="absolute end-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="pe-6 text-base font-semibold">{t("consent.wantUpdates")}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={() => answer("grant")} disabled={pending} className="flex-1">
              {t("consent.yesKeepMePosted")}
            </Button>
            <Button variant="ghost" onClick={() => answer("decline")} disabled={pending}>
              {t("consent.noThanks")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <p className="text-sm">{note}</p>
        </div>
      )}
    </div>
  )
}
