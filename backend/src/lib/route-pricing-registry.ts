/**
 * The pricing chain of a route, read off the route as the app REGISTERED it.
 *
 * `POST /v1/quote` prices a node with the chain its run route registers — the
 * functions before its credit guard, the guard's resolver and the guard's
 * options — never a copy (src/__tests__/quote-route-pricing.test.ts). A route
 * this repo writes exports that chain as a `RoutePricing` and registers it. A
 * route registered by code this repo does not hold (a deployment's own module)
 * exports nothing here, so its chain is read from the registration itself:
 * every preHandler `creditGuard` returns carries the resolver and options it
 * was built with (`creditGuardModelOf`), and the preHandlers before it are the
 * route's pre-checks. The quote of such a node is therefore the run's own
 * chain by construction, whatever version of the route is loaded.
 *
 * FAIL CLOSED, and only by the route's own word (review round, decided
 * 2026-11-23). A route is kept only when:
 *  - it says so: `config: { quotable: true }`. That is the route's promise
 *    that its pre-checks may run for a quote — they refuse what the run
 *    refuses and write nothing (a quote stores, holds and starts nothing);
 *  - its credit guard is its LAST preHandler: a refusal registered after the
 *    guard would run on the run and never on the quote;
 *  - it has no other door of its own the quote would skip: no route-level
 *    `onRequest`, `preParsing` or `preValidation`, and no body `schema`.
 * Anything else is not kept, and its node type cannot be quoted.
 *
 * One registry per app (`app.ts` makes it, notes every route through one root
 * `onRoute` hook, and hands it to the routes as `app.routePricingOf`), so two
 * apps in one process never read each other's routes. The first registration
 * of an address is the one kept: a later one the router refuses (a duplicate)
 * never replaces the live route's chain.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { creditGuardModelOf, isCreditGuard, type RoutePricing } from "../middleware/credit-guard.js"

type PreCheck = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>

/** What Fastify hands `onRoute`, as far as this reads it. */
export interface RegisteredRoute {
  readonly method: string | readonly string[]
  readonly url: string
  readonly preHandler?: unknown
  readonly onRequest?: unknown
  readonly preParsing?: unknown
  readonly preValidation?: unknown
  readonly schema?: { readonly body?: unknown } | undefined
  readonly config?: unknown
}

export interface RoutePricingRegistry {
  /** Fastify's `onRoute` hook: keep the chain of a route that may be quoted (see the module comment). */
  readonly note: (route: RegisteredRoute) => void
  /** The pricing chain registered at `url`, or undefined. */
  readonly pricingOf: (url: string) => RoutePricing | undefined
}

const isSet = (hook: unknown): boolean => (Array.isArray(hook) ? hook.length > 0 : hook !== undefined && hook !== null)

/** The chain of `route` when it may be quoted, else undefined. */
export function quotableRoutePricing(route: RegisteredRoute): RoutePricing | undefined {
  const methods = Array.isArray(route.method) ? route.method : [route.method]
  if (!methods.includes("POST")) return undefined
  if ((route.config as { quotable?: unknown } | undefined)?.quotable !== true) return undefined
  if (isSet(route.onRequest) || isSet(route.preParsing) || isSet(route.preValidation) || route.schema?.body !== undefined) return undefined
  const pre: unknown[] = route.preHandler === undefined ? [] : Array.isArray(route.preHandler) ? [...route.preHandler] : [route.preHandler]
  const guard = pre[pre.length - 1]
  if (!isCreditGuard(guard)) return undefined
  const model = creditGuardModelOf(guard)
  if (!model) return undefined
  const prechecks = pre.slice(0, -1)
  if (!prechecks.every((fn): fn is PreCheck => typeof fn === "function")) return undefined
  return { prechecks, modelResolver: model.modelResolver, ...(model.opts ? { opts: model.opts } : {}) }
}

export function createRoutePricingRegistry(): RoutePricingRegistry {
  const chains = new Map<string, RoutePricing>()
  return {
    note(route) {
      if (chains.has(route.url)) return
      const pricing = quotableRoutePricing(route)
      if (pricing) chains.set(route.url, pricing)
    },
    pricingOf: (url) => chains.get(url),
  }
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** The route's own word that `POST /v1/quote` may run its pricing chain (see the module comment). */
    quotable?: boolean
  }
  interface FastifyInstance {
    /** The pricing chain a quotable route registered at `url` (lib/route-pricing-registry.ts). Absent on an app built without the registry. */
    routePricingOf?: (url: string) => RoutePricing | undefined
  }
}
