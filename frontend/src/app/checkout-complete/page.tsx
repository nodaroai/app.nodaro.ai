import { useSearchParams } from "react-router-dom"
import { CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NodaroLogo } from "@/components/nodaro-logo"

/**
 * Public, no-auth confirmation page for the NEW TAB that Stripe Checkout
 * returns to when the flow was started from an embedded iframe (e.g.
 * studio.nodaro.ai's pricing / billing modal). The app's normal /billing
 * return URL would bounce this tab to /login — its session lives in the parent
 * app, not here — so embedded checkouts return here instead (see the `embedded`
 * flag in backend `billing.ts`).
 *
 * The purchase itself is granted server-side via Stripe webhooks; this page is
 * purely the "you're done, close this tab" affordance. The parent app refreshes
 * the balance / plan on its own.
 */
export default function CheckoutCompletePage() {
  const [params] = useSearchParams()
  const cancelled = params.get("status") === "cancelled"

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <NodaroLogo size="md" />

      <div className="mt-10 flex flex-col items-center">
        {cancelled ? (
          <XCircle className="h-12 w-12 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="h-12 w-12 text-green-500" />
        )}

        <h1 className="mt-4 text-2xl font-semibold">
          {cancelled ? "Checkout cancelled" : "Payment complete"}
        </h1>

        <p className="mt-2 max-w-sm text-muted-foreground">
          {cancelled
            ? "No charge was made. You can close this tab and try again from the app."
            : "Thank you! You can close this tab — your plan and credits update automatically in the app."}
        </p>

        {/* This tab was opened via window.open(), so close() is permitted in
            most browsers; harmless no-op where it's blocked. */}
        <Button className="mt-8" onClick={() => window.close()}>
          Close this tab
        </Button>
      </div>
    </div>
  )
}
