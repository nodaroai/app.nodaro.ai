import { llmMeteredPricing } from "./config.js"

/**
 * Whether side holds can be reserved RIGHT NOW (metered pricing on). Read it
 * per call, never cache it. A leaf, so a price surface (the UGC quote) can ask
 * without joining `llm-side-hold.ts`'s import cycle; `llm-side-hold.ts`
 * re-exports it and gates every reservation on it.
 */
export function sideHoldsAvailable(): boolean {
  return llmMeteredPricing()
}
