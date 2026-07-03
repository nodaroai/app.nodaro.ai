/**
 * System-prompt builder for the video-director authoring core (Unit C).
 *
 * Reads the doctrine body + the matching genre addendum from
 * `backend/skills/video-director/` and appends a strict JSON-output footer so
 * the LLM returns exactly the machine-contract shape: { voScript, cues, shotSequenceBrief }.
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { BrandTokens } from "@nodaro/shared"

const here = dirname(fileURLToPath(import.meta.url))
/** Path to `backend/skills/video-director/` relative to this source file. */
const DOCTRINE_DIR = resolve(here, "../../../skills/video-director")

export type VideoGenre = "explainer" | "product-launch"

const GENRE_FILE: Record<VideoGenre, string> = {
  "explainer": "explainer.md",
  "product-launch": "product-launch.md",
}

const JSON_OUTPUT_FOOTER = `
---

## Output instruction

Respond with EXACTLY one JSON object — no prose, no explanation before or after. Follow the machine contract shape:

\`\`\`
{
  "voScript": "<full spoken narration>",
  "cues": [{ "id": "<unique-id>", "text": "<whitespace-exact substring of voScript>" }],
  "shotSequenceBrief": { ... full brief per the machine contract above ... }
}
\`\`\`

Hard rules the JSON MUST satisfy:
1. voScript is the full narration as a single string.
2. cues is an ordered array of { id, text } objects; every text is a whitespace-exact substring of voScript.
3. shotSequenceBrief.narration.script MUST equal voScript verbatim.
4. shotSequenceBrief.narration.cues MUST equal cues verbatim (mirror them).
5. All scene ids and reveal ids are globally unique across the entire brief.
6. At most ONE revealAt:{kind:"frame",frame:0} poster; every other reveal uses {kind:"cue",cueId,edge:"start"}.
7. No spring easing. Weight reveals to the back ~50% of the VO.

Return ONLY the JSON object — nothing else.
`

/**
 * Build a brand block appended to the system prompt so the LLM authors element
 * colors/fonts FROM the supplied palette. Returns the empty string when no
 * brand is provided, so the no-brand prompt is byte-for-byte unchanged.
 */
export function buildBrandBlock(brand?: BrandTokens): string {
  if (!brand) return ""
  return (
    `\n\n---\n\n## Brand\n` +
    `Use THIS brand consistently across every scene and blueprint — do not invent other colors:\n` +
    `- background: ${brand.palette.bg}\n` +
    `- text: ${brand.palette.text}\n` +
    `- accent: ${brand.palette.accent}\n` +
    `- heading font: ${brand.fonts.heading}\n` +
    `- body font: ${brand.fonts.body}\n` +
    (brand.logo
      ? `- brand name: ${brand.logo.name}${brand.logo.tagline ? ` — ${brand.logo.tagline}` : ""}\n`
      : "")
  )
}

/**
 * Build the LLM system prompt for a given genre.
 *
 * Combines:
 * 1. The shared doctrine body (`doctrine.md`) — method, motion rules, machine contract.
 * 2. The genre-specific addendum (`explainer.md` or `product-launch.md`) — arc + reveal palette.
 * 3. A strict JSON-output footer so the model emits only the machine-contract JSON.
 * 4. An optional brand block (empty string when no brand) — palette + fonts + logo.
 */
export function buildAuthorSystemPrompt(genre: VideoGenre, brand?: BrandTokens): string {
  const doctrine = readFileSync(resolve(DOCTRINE_DIR, "doctrine.md"), "utf-8")
  const addendum = readFileSync(resolve(DOCTRINE_DIR, GENRE_FILE[genre]), "utf-8")
  return `${doctrine}\n\n---\n\n${addendum}\n\n${JSON_OUTPUT_FOOTER}${buildBrandBlock(brand)}`
}
