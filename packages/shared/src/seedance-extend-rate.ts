/**
 * Seedance 2.5 Extend's price rows — part of the public credit-id contract:
 * the rows a run is charged a multiple of, and so the ids a client names to
 * ask what a run costs (`tailExtendCreditId`, `credit-identifiers.ts`).
 *
 * A Seedance 2.5 Extend run sends the source's last
 * {@link SEEDANCE_EXTEND_CONTEXT_MAX_SEC} seconds (all of a shorter source)
 * and is charged per second sent and added. A per-second price is not a
 * whole credit, so each resolution's row is the price of
 * {@link SEEDANCE_EXTEND_RATE_SECONDS} seconds, and a run is that row × (seconds
 * sent + seconds added) ÷ 2, rounded up once. The rule itself (what is sent,
 * how a source's length is read) is `@nodaro/render-rules`
 * `seedance-extend-pricing.ts`.
 */
import type { SeedanceExtendProvider } from "./model-constants.js"

/** The Extend Video provider priced by the seconds it sends. */
export const SEEDANCE_EXTEND_SENT_PRICED_PROVIDER = "seedance-2-5-extend" satisfies SeedanceExtendProvider

/** The Extend Video provider priced by the seconds it sends. */
export type SentPricedSeedanceExtendProvider = typeof SEEDANCE_EXTEND_SENT_PRICED_PROVIDER

/** The most of the source's end a run sends as `@video_1`, in seconds. */
export const SEEDANCE_EXTEND_CONTEXT_MAX_SEC = 10

/** The seconds one rate row prices. */
export const SEEDANCE_EXTEND_RATE_SECONDS = 2

/** The rate row of each resolution: the price of {@link SEEDANCE_EXTEND_RATE_SECONDS} seconds. */
export const SEEDANCE_EXTEND_RATE_CREDIT_IDS: Readonly<Record<"480p" | "720p" | "1080p", string>> = {
  "480p": "seedance-2-5-extend:480p:per-2s",
  "720p": "seedance-2-5-extend:720p:per-2s",
  "1080p": "seedance-2-5-extend:1080p:per-2s",
}

/** Is `provider` the Extend Video provider priced by the seconds it sends? A retired id answers false: pass it through `canonicalVideoProvider` first. */
export function isSeedanceExtendPricedBySecondsSent(provider: unknown): provider is SentPricedSeedanceExtendProvider {
  return provider === SEEDANCE_EXTEND_SENT_PRICED_PROVIDER
}

/** Is `id` one of the rate rows? */
export function isSeedanceExtendRateCreditId(id: unknown): boolean {
  return typeof id === "string" && (Object.values(SEEDANCE_EXTEND_RATE_CREDIT_IDS) as string[]).includes(id)
}
