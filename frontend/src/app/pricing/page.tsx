"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ArrowLeft, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { openCheckout } from "@/lib/paddle"
import { PRICING_TIERS } from "@/lib/pricing-data"
import { ThemeToggle } from "@/components/theme-toggle"

export default function PricingPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  async function handleSubscribe(tierId: string, priceId: string | null) {
    if (!priceId) {
      router.push("/projects")
      return
    }

    if (!user) {
      router.push("/login")
      return
    }

    setLoadingTier(tierId)
    try {
      await openCheckout({
        priceId,
        userId: user.id,
        userEmail: user.email ?? undefined,
      })
    } catch (err) {
      console.error("[pricing] Checkout error:", err)
    } finally {
      setLoadingTier(null)
    }
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
      </section>

      {/* Tier Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-xl border p-6",
                "bg-card text-card-foreground",
                tier.highlighted
                  ? "border-[#ff0073] ring-2 ring-[#ff0073]/20 dark:ring-[#ff0073]/30"
                  : "border-zinc-200 dark:border-zinc-800",
              )}
            >
              {tier.highlighted && (
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
                  <span className="text-3xl font-bold">
                    ${tier.priceMonthly}
                  </span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tier.credits} credits / month
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
                  tier.highlighted
                    ? "bg-[#ff0073] text-white hover:bg-[#ff0073]/90"
                    : "",
                )}
                variant={tier.highlighted ? "default" : "outline"}
                disabled={loadingTier === tier.id}
                onClick={() => handleSubscribe(tier.id, tier.priceId)}
              >
                {loadingTier === tier.id ? "Loading..." : tier.cta}
              </Button>
            </div>
          ))}
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
