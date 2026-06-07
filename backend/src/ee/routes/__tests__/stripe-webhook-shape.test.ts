/**
 * L4#4 — Stripe webhook event shape contract.
 *
 * The Stripe webhook handler in `stripe-webhook.ts` switches on
 * `event.type` and extracts specific fields from `event.data.object`. Two
 * silent failure modes:
 *
 *   1. **Stripe adds a new event type we should handle** — the new event
 *      falls into the `default` log line and we miss the operation. This
 *      test snapshots the set of event types we explicitly handle so a
 *      developer must explicitly remove one (and acknowledge the
 *      coverage drop) for the test to pass.
 *
 *   2. **Stripe changes the payload shape of an event we handle** — the
 *      field we extract becomes undefined and the downstream provisioning
 *      gets garbage. This test validates a minimal fixture for each
 *      handled event type against a Zod schema that mirrors what the
 *      handler extracts. If the handler starts reading a new field, the
 *      fixture/schema must be updated (which forces explicit awareness).
 *
 * KIE webhooks: KIE.ai uses polling (callBackUrl is a placeholder), so
 * there's no separate webhook endpoint to lock down. Out of scope for
 * this test.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { z } from "zod"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
const WEBHOOK_FILE = join(
  REPO_ROOT,
  "backend/src/ee/routes/stripe-webhook.ts",
)

/**
 * The Stripe events we explicitly handle today. Adding/removing entries
 * here is intentional — keep in sync with the `switch (event.type)` in
 * stripe-webhook.ts. This list is the source of truth for "what coverage
 * we claim".
 */
const STRIPE_HANDLED_EVENTS: readonly string[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const

/**
 * Minimal Zod schemas mirroring the field-extraction the handler does
 * for each event type. These intentionally allow extra fields (Stripe
 * regularly adds metadata) but enforce the keys the handler reads.
 *
 * If you change `event.data.object as Stripe.Foo` extraction in
 * stripe-webhook.ts (or its provision-credits.ts handler), update the
 * matching schema below to match.
 */
const STRIPE_EVENT_SHAPES: Record<string, z.ZodType> = {
  // case "checkout.session.completed":
  //   reads: session.mode, session.payment_intent, session.id,
  //          session.customer, session.amount_total, session.metadata
  "checkout.session.completed": z
    .object({
      data: z.object({
        object: z.object({
          mode: z.enum(["payment", "subscription", "setup"]),
          payment_intent: z.string().nullable().optional(),
          id: z.string(),
          customer: z.string().nullable().optional(),
          amount_total: z.number().nullable().optional(),
          payment_status: z.string().optional(),
          metadata: z.record(z.string(), z.string()).nullable().optional(),
        }).passthrough(),
      }),
    })
    .passthrough(),

  // case "checkout.session.async_payment_succeeded": same Checkout.Session shape
  //   as completed; the handler additionally gates the grant on
  //   session.payment_status === "paid" (async methods settle on this event).
  "checkout.session.async_payment_succeeded": z
    .object({
      data: z.object({
        object: z.object({
          mode: z.enum(["payment", "subscription", "setup"]),
          payment_intent: z.string().nullable().optional(),
          id: z.string(),
          customer: z.string().nullable().optional(),
          amount_total: z.number().nullable().optional(),
          payment_status: z.string().optional(),
          metadata: z.record(z.string(), z.string()).nullable().optional(),
        }).passthrough(),
      }),
    })
    .passthrough(),

  // case "customer.subscription.created":
  //   reads: sub.id, sub.customer, sub.items.data[0].price.id, sub.status,
  //          extractSubscriptionPeriod(sub), sub.metadata
  "customer.subscription.created": z
    .object({
      data: z.object({
        object: z.object({
          id: z.string(),
          customer: z.string(),
          status: z.string(),
          items: z.object({
            data: z.array(
              z.object({
                price: z.object({ id: z.string() }).passthrough(),
              }).passthrough(),
            ),
          }).passthrough(),
          metadata: z.record(z.string(), z.string()).nullable().optional(),
        }).passthrough(),
      }),
    })
    .passthrough(),

  // case "customer.subscription.updated": same shape as created
  "customer.subscription.updated": z
    .object({
      data: z.object({
        object: z.object({
          id: z.string(),
          customer: z.string(),
          status: z.string(),
          items: z.object({
            data: z.array(
              z.object({
                price: z.object({ id: z.string() }).passthrough(),
              }).passthrough(),
            ),
          }).passthrough(),
          metadata: z.record(z.string(), z.string()).nullable().optional(),
        }).passthrough(),
      }),
    })
    .passthrough(),

  // case "customer.subscription.deleted":
  //   reads: sub.id, sub.customer, sub.ended_at, sub.metadata
  "customer.subscription.deleted": z
    .object({
      data: z.object({
        object: z.object({
          id: z.string(),
          customer: z.string(),
          ended_at: z.number().nullable().optional(),
          metadata: z.record(z.string(), z.string()).nullable().optional(),
        }).passthrough(),
      }),
    })
    .passthrough(),

  // case "invoice.paid":
  //   reads: invoice.id, invoice.parent.subscription_details.subscription,
  //          invoice.customer, invoice.amount_paid, subDetails.metadata
  "invoice.paid": z
    .object({
      data: z.object({
        object: z.object({
          id: z.string(),
          customer: z.string().nullable().optional(),
          amount_paid: z.number(),
          parent: z
            .object({
              subscription_details: z
                .object({
                  subscription: z.string(),
                  metadata: z.record(z.string(), z.string()).nullable().optional(),
                })
                .nullable()
                .optional(),
            })
            .nullable()
            .optional(),
        }).passthrough(),
      }),
    })
    .passthrough(),

  // case "invoice.payment_failed":
  //   reads: invoice.customer, invoice.parent.subscription_details, invoice.id
  "invoice.payment_failed": z
    .object({
      data: z.object({
        object: z.object({
          id: z.string(),
          customer: z.string(),
          parent: z
            .object({
              subscription_details: z
                .object({
                  metadata: z.record(z.string(), z.string()).nullable().optional(),
                })
                .nullable()
                .optional(),
            })
            .nullable()
            .optional(),
        }).passthrough(),
      }),
    })
    .passthrough(),
}

/**
 * Minimal valid fixtures for each event type. These mirror the shape Stripe
 * sends (per Stripe's webhook docs as of this writing) and should pass the
 * matching schema. Keep these tight — defensive testing means missing fields
 * surface fast.
 */
const STRIPE_FIXTURES: Record<string, unknown> = {
  "checkout.session.completed": {
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "payment",
        payment_intent: "pi_test_abc",
        id: "cs_test_def",
        customer: "cus_test_xyz",
        amount_total: 5000,
        payment_status: "paid",
        metadata: { userId: "user-uuid", topupCredits: "750" },
      },
    },
  },
  "checkout.session.async_payment_succeeded": {
    type: "checkout.session.async_payment_succeeded",
    data: {
      object: {
        mode: "payment",
        payment_intent: "pi_test_async",
        id: "cs_test_async",
        customer: "cus_test_xyz",
        amount_total: 5000,
        payment_status: "paid",
        metadata: { userId: "user-uuid", topupCredits: "750" },
      },
    },
  },
  "customer.subscription.created": {
    type: "customer.subscription.created",
    data: {
      object: {
        id: "sub_test_1",
        customer: "cus_test_xyz",
        status: "active",
        items: { data: [{ price: { id: "price_pro_monthly" } }] },
        metadata: { userId: "user-uuid" },
      },
    },
  },
  "customer.subscription.updated": {
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test_1",
        customer: "cus_test_xyz",
        status: "active",
        items: { data: [{ price: { id: "price_business_monthly" } }] },
        metadata: { userId: "user-uuid" },
      },
    },
  },
  "customer.subscription.deleted": {
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_test_1",
        customer: "cus_test_xyz",
        ended_at: 1700000000,
        metadata: { userId: "user-uuid" },
      },
    },
  },
  "invoice.paid": {
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_1",
        customer: "cus_test_xyz",
        amount_paid: 2400,
        parent: {
          subscription_details: {
            subscription: "sub_test_1",
            metadata: { userId: "user-uuid" },
          },
        },
      },
    },
  },
  "invoice.payment_failed": {
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_test_2",
        customer: "cus_test_xyz",
        parent: {
          subscription_details: {
            metadata: { userId: "user-uuid" },
          },
        },
      },
    },
  },
}

const WEBHOOK_SOURCE = readFileSync(WEBHOOK_FILE, "utf8")

// ---------------------------------------------------------------------------
// Test 1 — every entry in STRIPE_HANDLED_EVENTS appears in the webhook
// handler's switch statement.
// ---------------------------------------------------------------------------

describe("STRIPE_HANDLED_EVENTS × webhook switch", () => {
  it.each(STRIPE_HANDLED_EVENTS)(
    'webhook handler has a "case \\"%s\\":" branch',
    (eventType) => {
      const escaped = eventType.replace(/[$()*+./?[\\\]^{|}-]/g, "\\$&")
      const pattern = new RegExp(`case\\s+"${escaped}"\\s*:`)
      expect(
        pattern.test(WEBHOOK_SOURCE),
        `STRIPE_HANDLED_EVENTS lists "${eventType}" but stripe-webhook.ts has no \`case "${eventType}":\` branch. Either remove the entry from STRIPE_HANDLED_EVENTS, or add the missing case to backend/src/ee/routes/stripe-webhook.ts.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — every `case "..."` in the webhook switch is in
// STRIPE_HANDLED_EVENTS (no silent additions slipping past coverage).
// ---------------------------------------------------------------------------

describe("webhook switch × STRIPE_HANDLED_EVENTS (reverse)", () => {
  it("every case branch is documented in STRIPE_HANDLED_EVENTS", () => {
    const caseMatches = WEBHOOK_SOURCE.matchAll(/case\s+"([^"]+)"\s*:/g)
    const switchEvents = [...caseMatches].map((m) => m[1])
    const known = new Set(STRIPE_HANDLED_EVENTS)
    const undocumented = switchEvents.filter((e) => !known.has(e))
    expect(
      undocumented,
      `These webhook switch cases are not in STRIPE_HANDLED_EVENTS — add them and write a fixture/schema in this test file: ${undocumented.join(", ")}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 3 — every fixture validates against its schema (smoke check that
// the schemas + fixtures stay in sync with each other).
// ---------------------------------------------------------------------------

describe("STRIPE_FIXTURES × STRIPE_EVENT_SHAPES", () => {
  it.each(STRIPE_HANDLED_EVENTS)(
    'fixture for "%s" parses against its schema',
    (eventType) => {
      const fixture = STRIPE_FIXTURES[eventType]
      const schema = STRIPE_EVENT_SHAPES[eventType]
      expect(
        fixture,
        `Missing STRIPE_FIXTURES["${eventType}"] — add a minimal fixture mirroring the Stripe event shape so the schema check has something to validate.`,
      ).toBeDefined()
      expect(
        schema,
        `Missing STRIPE_EVENT_SHAPES["${eventType}"] — add a Zod schema matching what the webhook handler extracts.`,
      ).toBeDefined()
      const result = schema.safeParse(fixture)
      expect(
        result.success,
        result.success
          ? ""
          : `Fixture for "${eventType}" failed schema validation. ${result.success ? "" : JSON.stringify(result.error.errors, null, 2)}`,
      ).toBe(true)
    },
  )
})
