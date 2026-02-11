"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, ArrowLeft, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { openCheckout } from "@/lib/paddle"
import { getSubscription, changePlan, type SubscriptionInfo } from "@/lib/api"
import {
  PRICING_TIERS,
  getTierPrice,
  getTierPriceId,
  getAnnualSavingsPercent,
  type BillingCycle,
} from "@/lib/pricing-data"
import { ThemeToggle } from "@/components/theme-toggle"
import { toast } from "sonner"

export default function PricingPage() {
  return (
    <Suspense>
      <PricingPageContent />
    </Suspense>
  )
}

function PricingPageContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [subLoading, setSubLoading] = useState(false)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual")
  const searchParams = useSearchParams()
  const autoCheckoutTriggered = useRef(false)

  // Fetch current subscription when user is available
  useEffect(() => {
    if (!user?.id) return
    setSubLoading(true)
    getSubscription(user.id)
      .then((sub) => setSubscription(sub))
      .finally(() => setSubLoading(false))
  }, [user?.id])

  // Derive current tier from active subscription
  const isActiveSub = subscription &&
    (subscription.status === "active" || subscription.status === "past_due")
  const currentTierId = isActiveSub
    ? PRICING_TIERS.find(
        (t) =>
          t.priceIdAnnual === subscription.paddle_price_id ||
          t.priceIdMonthly === subscription.paddle_price_id,
      )?.id ?? null
    : null

  // Auto-open Paddle checkout when redirected from login with ?plan= param
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

  // Max savings across all paid tiers (for the toggle badge)
  const maxSavings = Math.max(
    ...PRICING_TIERS.filter((t) => t.priceMonthly > 0).map(getAnnualSavingsPercent),
  )

  async function handleSubscribe(tierId: string, priceId: string | null) {
    if (!priceId) {
      router.push("/projects")
      return
    }

    if (!user) {
      router.push(`/login?plan=${tierId}`)
      return
    }

    setLoadingTier(tierId)
    try {
      if (isActiveSub) {
        await changePlan(user.id, priceId)
        toast.success("Plan changed successfully! Changes will apply shortly.")
        router.push("/billing?success=true")
      } else {
        await openCheckout({
          priceId,
          userId: user.id,
          userEmail: user.email ?? undefined,
        })
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
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link
            href="/projects"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to app
          </Link>
          <Link href="/" className="text-lg font-bold text-[#ff0073]">
            SceneNode
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {!authLoading && !user && (
              <Link href="/login">
                <Button variant="outline" size="sm">Sign in</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

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
            {maxSavings > 0 && (
              <span
                className={cn(
                  "text-xs font-semibold px-2 py-0.5 rounded-full",
                  billingCycle === "annual"
                    ? "bg-white/20 text-white"
                    : "bg-green-500/10 text-green-600 dark:text-green-400",
                )}
              >
                Save {maxSavings}%
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
            const savings = getAnnualSavingsPercent(tier)

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
                        ? `$${tier.priceAnnual * 12}/yr \u00b7 Save ${savings}%`
                        : "Billed monthly"
                      : `${tier.credits} credits / month`}
                  </p>
                </div>

                <ul className="flex-1 space-y-2.5 mb-6">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-[#ff0073] flex-shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{feature}</span>
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
            <Link href="/billing" className="text-[#ff0073] underline underline-offset-4">
              top-up packs
            </Link>{" "}
            any time. Credits never expire.
          </p>
        </div>
      </section>
    </div>
  )
}
