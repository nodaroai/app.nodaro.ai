import { Command } from "commander"
import type { BillingMoney, BillingPlan, BillingPriceCredits } from "@nodaro/sdk"
import { buildClient, buildPublicClient, handleError } from "../client.js"
import { detail, dim, emit, info, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

const GIB = 1024 * 1024 * 1024

function money(m: BillingMoney): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: m.currency }).format(m.amount)
  } catch {
    return `${m.amount} ${m.currency}`
  }
}

/** A price cell: what the plan costs, "free" when there is nothing to pay, "unavailable" when it could not be read. */
function priceCell(plan: BillingPlan, slot: "monthly" | "yearly"): string {
  if (plan.prices === null) return "free"
  if (slot === "monthly") return plan.prices.monthly ? money(plan.prices.monthly) : "unavailable"
  const yearly = plan.prices.yearly
  if (!yearly) return "unavailable"
  return yearly.perMonth === null
    ? money(yearly)
    : `${money(yearly)} (${money({ amount: yearly.perMonth, currency: yearly.currency })} a month)`
}

function grant(credits: BillingPriceCredits): string {
  return `${credits.amount.toLocaleString("en")} / ${credits.per}`
}

/** What the plan grants: the free plan's one-time grant, else what each price states. */
function creditsCell(plan: BillingPlan): string {
  if (plan.signupCredits !== null) return `${plan.signupCredits.toLocaleString("en")} once`
  const monthly = plan.prices?.monthly?.credits ?? null
  const yearly = plan.prices?.yearly?.credits ?? null
  if (monthly && yearly) {
    return monthly.amount === yearly.amount && monthly.per === yearly.per
      ? grant(monthly)
      : `${grant(monthly)} (yearly: ${grant(yearly)})`
  }
  if (monthly) return grant(monthly)
  return yearly ? `yearly: ${grant(yearly)}` : "-"
}

function storageCell(bytes: number): string {
  const gb = bytes / GIB
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
}

export function billingCommand(): Command {
  const cmd = new Command("billing").description(
    "plans and prices, your subscription, and how this deployment bills (buying stays in the app)",
  )

  cmd
    .command("plans")
    .description("the plans and credit packs on sale, with their prices (Nodaro Cloud; no sign-in needed)")
    .option("--profile <name>", "ask this profile's instance (its token is not sent)")
    .option("--base-url <url>", "ask this instance instead (default: the profile's, else https://app.nodaro.ai)")
    .option("--json")
    .addHelpText(
      "after",
      `
Examples:
  $ nodaro billing plans
  $ nodaro billing plans --json`,
    )
    .action(async (opts: GlobalOpts & { baseUrl?: string }) => {
      try {
        // A public route: no sign-in needed, so no credential is sent.
        const client = buildPublicClient({ profile: opts.profile, baseUrl: opts.baseUrl })
        const result = await client.billing.plans()
        if (opts.json) {
          emit(result, opts)
          return
        }
        table(
          result.data.map((plan) => ({
            id: plan.id,
            name: plan.name,
            monthly: priceCell(plan, "monthly"),
            yearly: priceCell(plan, "yearly"),
            credits: creditsCell(plan),
            parallel: plan.parallelism,
            storage: storageCell(plan.storageBytes),
          })),
          ["id", "name", "monthly", "yearly", "credits", "parallel", "storage"],
        )
        info("")
        table(
          result.topUps.map((pack) => ({
            id: pack.id,
            credits: pack.credits.toLocaleString("en"),
            price: pack.price ? money(pack.price) : "unavailable",
          })),
          ["id", "credits", "price"],
        )
        const { min, max, currency } = result.topUpRange
        dim(`Or load any whole amount from ${money({ amount: min, currency })} to ${money({ amount: max, currency })} in the app.`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("subscription")
    .description("your subscription, and the plan your account's entitlements follow (Nodaro Cloud)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.billing.subscription()
        if (opts.json) {
          emit(result, opts)
          return
        }
        if (!result.data) {
          info(`No subscription. Plan in force: ${result.effectiveTier}`)
          return
        }
        detail(result)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("account")
    .description("your plan and balance as this deployment's billing provider reports them, in its unit")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const account = await client.billing.account()
        if (opts.json) {
          emit(account, opts)
          return
        }
        if (account === null) {
          info("The billing provider could not answer right now; this is not a zero balance.")
          return
        }
        detail(account)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("surface")
    .description("how this deployment bills: whether it meters usage, and the unit costs display in (no sign-in needed)")
    .option("--profile <name>", "ask this profile's instance (its token is not sent)")
    .option("--base-url <url>", "ask this instance instead (default: the profile's, else https://app.nodaro.ai)")
    .option("--json")
    .action(async (opts: GlobalOpts & { baseUrl?: string }) => {
      try {
        const client = buildPublicClient({ profile: opts.profile, baseUrl: opts.baseUrl })
        const surface = await client.billing.surface()
        if (opts.json) {
          emit(surface, opts)
          return
        }
        detail(surface)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
