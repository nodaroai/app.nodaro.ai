import { getKieModelConfig } from "../providers/kie/models.js"
import { DEFAULT_ENTITY_REF_CAP } from "./character-reference-set.js"

/**
 * Max reference images the entity image worker will send to a provider —
 * capability-driven (the KIE model's `maxRefImages`), falling back to the
 * conservative `DEFAULT_ENTITY_REF_CAP` for non-KIE / unknown providers (e.g.
 * Flux 2 via Replicate) so a multi-image payload can never blow past a
 * provider's real input limit.
 *
 * Shared by the `generate-character-asset` route — which counts the capped set
 * to reserve the correct per-reference credit tier for ref-priced providers
 * (Flux 2) — and the worker, which caps what it actually sends. Using ONE helper
 * keeps the reserved ref count and the sent ref count in lock-step.
 */
export function entityImageRefCap(provider: string): number {
  return getKieModelConfig("image", provider)?.maxRefImages ?? DEFAULT_ENTITY_REF_CAP
}
