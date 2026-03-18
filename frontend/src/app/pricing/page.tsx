import { useState, useEffect, useRef } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Check, ArrowLeft, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NodaroLogo } from "@/components/nodaro-logo"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import {
  PRICING_TIERS,
  getTierPrice,
  getTierPriceId,
  getAnnualSavingsDollars,
  type BillingCycle,
} from "@/lib/pricing-data"
import { createCheckoutSession } from "@/lib/api"
import { ThemeToggle } from "@/components/theme-toggle"
import { toast } from "sonner"
import { useSubscription, useChangePlanMutation } from "@/hooks/queries/use-billing-queries"

export default function PricingPage() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const isEmbedded = location.pathname.startsWith("/_")
  const navigate = useNavigate()
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual")
  const [searchParams] = useSearchParams()
  const autoCheckoutTriggered = useRef(false)

  const { data: subscription, isLoading: subLoading } = useSubscription(user?.id)
  const changePlanMutation = useChangePlanMutation()

  // Derive current tier from active subscription
  const isActiveSub = subscription &&
    (subscription.status === "active" || subscription.status === "past_due")
  const currentTierId = isActiveSub
    ? PRICING_TIERS.find(
        (t) =>
          t.priceIdAnnual === subscription.stripe_price_id ||
          t.priceIdMonthly === subscription.stripe_price_id,
      )?.id ?? null
    : null

  // Auto-open Stripe checkout when redirected from login with ?plan= param
  useEffect(() => {
    if (authLoading || subLoading || autoCheckoutTriggered.current) return
    const planParam = searchParams.get("plan")
    if (!planParam || !user || isActiveSub) return

    const tier = PRICING_TIERS.find((t) => t.id === planParam)
    if (!tier) return

    const priceId = getTierPriceId(tier, billingCycle)
    if (!priceId) return

    autoCheckoutTriggered.current = true
    handleSubscribe(tier.id, priceId)
  }, [authLoading, subLoading, user, isActiveSub, searchParams, billingCycle])

  // Whether any paid tier has annual savings (for the toggle badge)
  const hasAnnualSavings = PRICING_TIERS.some((t) => t.priceMonthly > 0 && t.priceAnnual < t.priceMonthly)

  async function handleSubscribe(tierId: string, priceId: string | null) {
    if (!priceId) {
      navigate("/projects")
      return
    }

    if (!user) {
      navigate(`/login?plan=${tierId}`)
      return
    }

    setLoadingTier(tierId)
    try {
      if (isActiveSub) {
        await changePlanMutation.mutateAsync({ userId: user.id, priceId })
        toast.success("Plan changed successfully! Changes will apply shortly.")
        navigate("/billing?success=true")
      } else {
        const url = await createCheckoutSession({ priceId, mode: "subscription" })
        window.location.href = url
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong"
      toast.error(message)
    } finally {
      setLoadingTier(null)
    }
  }

  function getButtonLabel(tierId: string): string {
    if (loadingTier === tierId) return "Processing..."
    if (tierId === currentTierId) return "Current Plan"
    if (currentTierId) return "Switch Plan"
    return PRICING_TIERS.find((t) => t.id === tierId)?.cta ?? "Subscribe"
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header — hidden when rendered inside DashboardLayout (/_pricing) */}
      {!isEmbedded && (
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <Link
              to="/projects"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to app
            </Link>
            <Link to="/" className="flex items-center">
              <NodaroLogo size="md" />
            </Link>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              {!authLoading && !user && (
                <Link to="/login">
                  <Button variant="outline" size="sm">Sign in</Button>
                </Link>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Hero */}
      <section className="py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Simple, transparent pricing
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
          Start free and scale as you grow. All plans include access to the
          visual workflow editor and AI video generation tools.
        </p>

        {/* Billing cycle toggle */}
        <div className="mt-8 inline-flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 p-1 bg-card">
          <button
            className={cn(
              "rounded-full px-5 py-2 text-sm font-medium transition-colors",
              billingCycle === "monthly"
                ? "bg-[#ff0073] text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setBillingCycle("monthly")}
          >
            Monthly
          </button>
          <button
            className={cn(
              "rounded-full px-5 py-2 text-sm font-medium transition-colors flex items-center gap-2",
              billingCycle === "annual"
                ? "bg-[#ff0073] text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setBillingCycle("annual")}
          >
            Annual
            {hasAnnualSavings && (
              <span
                className={cn(
                  "text-xs font-semibold px-2 py-0.5 rounded-full",
                  billingCycle === "annual"
                    ? "bg-white/20 text-white"
                    : "bg-green-500/10 text-green-600 dark:text-green-400",
                )}
              >
                2 months free
              </span>
            )}
          </button>
        </div>
      </section>

      {/* Tier Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {PRICING_TIERS.map((tier) => {
            const isCurrent = tier.id === currentTierId
            const displayPrice = getTierPrice(tier, billingCycle)
            const priceId = getTierPriceId(tier, billingCycle)
            const savingsDollars = getAnnualSavingsDollars(tier)

            return (
              <div
                key={tier.id}
                className={cn(
                  "relative flex flex-col rounded-xl border p-6",
                  "bg-card text-card-foreground",
                  isCurrent
                    ? "border-green-500 ring-2 ring-green-500/20"
                    : tier.highlighted
                      ? "border-[#ff0073] ring-2 ring-[#ff0073]/20 dark:ring-[#ff0073]/30"
                      : "border-zinc-200 dark:border-zinc-800",
                )}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center rounded-full bg-green-500 px-3 py-1 text-xs font-medium text-white">
                      Current Plan
                    </span>
                  </div>
                )}
                {!isCurrent && tier.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#ff0073] px-3 py-1 text-xs font-medium text-white">
                      <Zap className="h-3 w-3" />
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold">{tier.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    {billingCycle === "annual" && tier.priceMonthly > 0 && (
                      <span className="text-lg text-muted-foreground line-through mr-1">
                        ${tier.priceMonthly}
                      </span>
                    )}
                    <span className="text-3xl font-bold">
                      ${displayPrice}
                    </span>
                    <span className="text-sm text-muted-foreground">/mo</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tier.priceMonthly > 0
                      ? billingCycle === "annual"
                        ? <><span className="text-foreground font-medium">${tier.priceAnnual * 12}</span>/yr · <span className="text-emerald-400 font-medium">Save ${savingsDollars}</span></>
                        : "Billed monthly"
                      : <span className="text-emerald-400 font-medium">🎁 {tier.credits} free credits</span>}
                  </p>
                </div>

                <ul className="flex-1 space-y-2.5 mb-6">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-[#ff0073] flex-shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">
                        {/^\d[\d,]* credits \/ month/.test(feature)
                          ? <><span className="text-foreground font-medium">{feature.replace(/ \/.*$/, '')}</span>{feature.match(/ \/.*$/)?.[0]}</>
                          : feature}
                      </span>
                    </li>
                  ))}
                </ul>

                <Button
                  className={cn(
                    "w-full",
                    !isCurrent && tier.highlighted
                      ? "bg-[#ff0073] text-white hover:bg-[#ff0073]/90"
                      : "",
                  )}
                  variant={!isCurrent && tier.highlighted ? "default" : "outline"}
                  disabled={isCurrent || loadingTier === tier.id || subLoading}
                  onClick={() => handleSubscribe(tier.id, priceId)}
                >
                  {getButtonLabel(tier.id)}
                </Button>
              </div>
            )
          })}
        </div>

        {/* FAQ / Extra info */}
        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground">
            Need more credits? Purchase{" "}
            <Link to="/billing" className="text-[#ff0073] underline underline-offset-4">
              top-up packs
            </Link>{" "}
            any time. Credits never expire.
          </p>
        </div>

        {/* Legal links */}
        <div className="mt-8 flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
          <a href="https://nodaro.ai/terms" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
            Terms of Service
          </a>
          <span>&middot;</span>
          <a href="https://nodaro.ai/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
            Privacy Policy
          </a>
          <span>&middot;</span>
          <a href="https://nodaro.ai/refund" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
            Refund Policy
          </a>
        </div>
      </section>
    </div>
  )
}
