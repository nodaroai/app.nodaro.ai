import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { CreditCard, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { completeFreeGrantActivation, startFreeGrantActivation } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { FREE_TIER_CREDITS } from "@/lib/pricing-data"
import { creditUnits, creditUnitLabel } from "@/lib/credit-units"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"

/**
 * The activation path for an account whose free signup grant was withheld.
 *
 * The account works; the credits did not arrive. Adding a payment method —
 * a $0 Stripe setup session, nothing charged — activates them, provided the
 * card has not already activated another account. The copy says "activate",
 * never "denied": most people who see this are on a shared machine, not
 * farming grants, and the login page advertised the credits to them.
 *
 * Two jobs in one component, because both need the same query and both
 * belong wherever the app shell mounts it: START (button → hosted Stripe
 * page) and COMPLETE (Stripe returns to /billing?activate_grant=<session>,
 * and this posts the id back exactly once).
 */

const PARAM = "activate_grant"

export function FreeGrantWithheldBanner() {
  const { user } = useAuth()
  const { data: balance } = useUserCredits(user?.id)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [starting, setStarting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const completedSession = useRef<string | null>(null)

  const sessionId = searchParams.get(PARAM)

  // COMPLETE. Runs once per session id regardless of what the balance query
  // says: the return leg races the refetch, and the state is still
  // 'withheld' until this call lands.
  useEffect(() => {
    if (!sessionId || !user?.id || completedSession.current === sessionId) return
    completedSession.current = sessionId
    setCompleting(true)
    completeFreeGrantActivation(sessionId)
      .then((res) => {
        if (res.activated || res.state === "granted") {
          toast.success(`Your ${creditUnits(FREE_TIER_CREDITS)} free ${creditUnitLabel()} are active`)
        } else {
          toast.error("Free credits could not be activated yet")
        }
        return queryClient.invalidateQueries({ queryKey: queryKeys.credits.balance(user.id) })
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Failed to activate free credits")
      })
      .finally(() => {
        setCompleting(false)
        // Strip the param so a reload cannot replay the completion.
        const next = new URLSearchParams(searchParams)
        next.delete(PARAM)
        setSearchParams(next, { replace: true })
      })
    // searchParams / setSearchParams are stable enough for a once-per-id effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, user?.id])

  if (balance?.freeGrantState !== "withheld" && !completing) return null

  async function handleStart() {
    setStarting(true)
    try {
      const { data } = await startFreeGrantActivation()
      window.location.assign(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start activation")
      setStarting(false)
    }
  }

  const busy = starting || completing

  return (
    <div
      role="status"
      data-testid="free-grant-withheld-banner"
      className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm"
      style={{ background: "var(--blg-card)", borderColor: "var(--blg-border-3)", color: "var(--blg-t1)" }}
    >
      <Sparkles className="h-4 w-4 shrink-0" style={{ color: "#ff0073" }} />
      <span className="flex-1 min-w-[16rem]">
        <span className="font-medium">
          Activate your {creditUnits(FREE_TIER_CREDITS)} free {creditUnitLabel()}.
        </span>{" "}
        <span style={{ color: "var(--blg-t2-dim)" }}>
          Add a payment method to unlock them — nothing is charged.
        </span>
      </span>
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        style={{ background: "#ff0073" }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
        {completing ? "Activating…" : "Add payment method"}
      </button>
    </div>
  )
}
