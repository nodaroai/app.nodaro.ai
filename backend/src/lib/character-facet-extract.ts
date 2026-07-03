/**
 * Server-side facet extraction for the Character node's Assets handle
 * (element/asset injection, P2). When a character or identity asset is wired
 * into another character with a chosen *facet* (Hair / Skin tone / Style / …),
 * the editor sends `{ sourceText, facet }` and we resolve it into a prompt
 * fragment here, at generation time:
 *
 *  - `full` (or any unknown facet id) → the source description verbatim, no LLM.
 *  - any other facet → LLM-extracted from the source description via
 *    {@link llmCompleteStructured} using the facet's canonical instruction.
 *
 * Failure is never fatal: an empty extract or any LLM error falls back to the
 * full source text, so a flaky extractor degrades to "inject everything" rather
 * than blocking the character generation. The extractor cost is tiny and is
 * absorbed into the character-generation credit (no separate charge).
 */
import { z } from "zod"
import { llmCompleteStructured } from "./llm-client.js"
import { DEFAULT_CHARACTER_FACET, getCharacterFacet } from "@nodaro/shared"

export interface FacetInjection {
  /** The source character/asset's canonical description. */
  sourceText: string
  /** Facet id from CHARACTER_FACETS (e.g. "hair", "skin-tone", "full"). */
  facet: string
}

const facetSchema = z.object({ facetText: z.string() })

/** Fast, reliable structured-output model for the extraction (Anthropic
 *  forced-tool path → no JSON drift). Overridable for tests. */
const FACET_MODEL = "claude-haiku-4.5"
/** Short timeout so a hung extractor can't stall the generate-character POST;
 *  on timeout we fall back to the full source text. */
const FACET_TIMEOUT_MS = 20_000

function facetSystemPrompt(instruction: string): string {
  return [
    "You extract a single visual facet from a character description, for use inside an image-generation prompt.",
    `From the description the user provides, return ONLY ${instruction}.`,
    "Answer with a concise descriptive phrase — no full sentences, no preamble, no other attributes.",
    "If the description does not mention this facet, return an empty string.",
  ].join(" ")
}

/** Extract one facet's prompt fragment, falling back to the full text on any
 *  failure or empty result. `full`/unknown facets skip the LLM entirely. */
async function resolveOne(inj: FacetInjection): Promise<string> {
  const text = inj.sourceText?.trim()
  if (!text) return ""
  const facet = getCharacterFacet(inj.facet)
  // "full" and unrecognised facets inject the whole description verbatim.
  if (!facet || inj.facet === DEFAULT_CHARACTER_FACET) return text
  try {
    const { output } = await llmCompleteStructured(
      {
        modelId: FACET_MODEL,
        system: facetSystemPrompt(facet.instruction),
        messages: [{ role: "user", content: text }],
        maxTokens: 512,
        temperature: 0,
        timeoutMs: FACET_TIMEOUT_MS,
      },
      facetSchema,
      // One retry only: this runs synchronously in the generate-character POST,
      // and a flaky extractor falls back to the full text anyway — so bound the
      // worst-case latency rather than retrying the default 2×.
      { schemaName: "facet", maxRetries: 1 },
    )
    return output.facetText?.trim() || text
  } catch {
    // LLM failure / schema miss → inject the full description; never 500.
    return text
  }
}

/**
 * Resolve facet injections into one comma-joined prompt fragment, preserving
 * input order. Extractions run in parallel. Empty/blank sources are skipped.
 * Returns "" when there is nothing to inject (byte-identical no-op upstream).
 */
export async function resolveFacetInjections(
  facetInjections: ReadonlyArray<FacetInjection> | undefined,
): Promise<string> {
  if (!facetInjections || facetInjections.length === 0) return ""
  const resolved = await Promise.all(facetInjections.map(resolveOne))
  return resolved.filter((s) => s.length > 0).join(", ")
}
