/**
 * The size `generate_image` sends the route, from what the call asked and what
 * this tool's own normaliser fitted (`normalizeResolution`).
 *
 * Exactly what the tool always sent, with one exception: 8K asked of an image
 * model whose sizes are K sizes (1K, 2K, 4K, ...) but that does not list 8K is
 * sent as "8K", so the route fits it to that model's largest K size (the size
 * the normaliser picks too) and says so in its adjustments. A model whose
 * sizes are not K sizes (Flux 2's megapixels) keeps what the normaliser
 * answered, so no input the tool accepted before is priced differently
 * (`mcp-resolution-dev-parity.test.ts`).
 */
import { getModel } from "@nodaro/shared/model-catalog"

const K_SIZE = /^\d+(?:\.\d+)?K$/i

export function mcpImageResolutionSent(asked: unknown, model: string, fitted: string | undefined): string | undefined {
  if (typeof asked !== "string" || asked.trim().toUpperCase() !== "8K") return fitted
  const m = getModel(model)
  const sizes = m?.kind === "image" ? (m.resolutions ?? []) : []
  if (!sizes.some((r) => K_SIZE.test(r)) || sizes.some((r) => r.toUpperCase() === "8K")) return fitted
  return "8K"
}
