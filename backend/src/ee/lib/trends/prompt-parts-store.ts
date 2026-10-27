/**
 * A trend's overrides of the Cast Swap engine's prompt parts
 * (`TrendVersionData.promptParts`; pure, no I/O).
 *
 * The engine owns each part's default and checks every override (its
 * `POST /v1/cast-swap/prompt-parts`, ee/lib/cast-swap-prompt-parts.ts); the
 * trend stores the text an admin saved with the hash of the default it
 * replaced, so the editor can flag a default that changed since. A run sends
 * the texts only (`promptPartTexts`, compose.ts).
 *
 * `promptPartsRequestFor` is what the engine is asked for a trend: its engine,
 * how its clip is prepared (with full depth's scene source) and its prompt
 * style (both resolved), its roles (placeholder pictures, the most a slot
 * takes, each its own address so none is numbered twice), its fixed
 * references and its full run's pre and trend prompts — the longest prompt a
 * run of it can assemble, which the engine's length check needs.
 *
 * The stored shape's schema is `trendPromptPartsSchema` (schemas.ts, in the
 * version schema).
 *
 * HIDDEN: everything here is the trend's recipe; nothing of it may reach a
 * public response.
 */
import { CAST_SWAP_PROMPT_PART_IDS } from "@nodaro/render-rules"
import { placeholderImageUrl, type PromptPartTexts, type PromptPartsAnswer, type PromptPartsRequest } from "../../../lib/cast-swap-prompt-parts-contract.js"

export { placeholderImageUrl }
import { CHIPS_BY_KIND, MAX_IMAGES_PER_SLOT, engineOf } from "./schemas.js"
import { withPromptsFor, type TrendPromptMode } from "./prompt-parts.js"
import { promptStyleOf, trendSceneOf, trendSourceOf } from "./prompt-style.js"
import type { TrendPromptPartOverrides, TrendSlot, TrendVersionData } from "./types.js"

/** The texts a run sends (`{ [id]: text }`, in part order), or undefined when the trend overrides none. */
export function promptPartTexts(stored: TrendPromptPartOverrides | undefined): PromptPartTexts | undefined {
  if (!stored) return undefined
  const out: PromptPartTexts = {}
  for (const id of CAST_SWAP_PROMPT_PART_IDS) {
    const entry = stored[id]
    if (entry) out[id] = entry.text
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The overrides to store: each text with the hash of the default the engine
 * answered for it. Null when the answer lacks a part that was sent (the
 * engine answered outside the contract).
 */
export function storedOverridesFrom(texts: PromptPartTexts, answer: PromptPartsAnswer): TrendPromptPartOverrides | null {
  const out: TrendPromptPartOverrides = {}
  for (const id of CAST_SWAP_PROMPT_PART_IDS) {
    const text = texts[id]
    if (text === undefined) continue
    const part = answer.parts.find((p) => p.id === id)
    if (!part) return null
    out[id] = { text, defaultHash: part.defaultHash }
  }
  return out
}

/** The slot's chips as a run with nothing chosen sends them: its defaults, else "new". */
function defaultChips(slot: TrendSlot): Record<string, string> {
  const defaults = (slot.defaults ?? {}) as Record<string, string | undefined>
  return Object.fromEntries(CHIPS_BY_KIND[slot.kind].map((chip) => [chip, defaults[chip] ?? "new"]))
}

/**
 * What the engine is asked for this trend, with `overrides` (none = the
 * stored ones' texts), as a run in `mode` sends its texts (the full run by
 * default; a 4 s preview's own role names and prompts where it has them).
 * Always with `source` and never a `style`: the engine reads that as a
 * trend's and checks its length with room for a run's user details
 * (`TREND_DETAILS_MAX` more post prompt).
 */
export function promptPartsRequestFor(
  data: TrendVersionData,
  overrides: PromptPartTexts | undefined = promptPartTexts(data.promptParts),
  mode: TrendPromptMode = "full",
): PromptPartsRequest {
  const texts = withPromptsFor(data, mode)
  const scene = trendSceneOf(data)
  return {
    engine: engineOf(data),
    source: trendSourceOf(data),
    promptStyle: promptStyleOf(data),
    ...(scene ? { scene } : {}),
    // The longest prompt: a clip with sound keeps its audio line.
    hasAudio: true,
    roles: texts.slots.map((slot, i) => ({
      kind: slot.kind,
      name: slot.roleName,
      images: Array.from({ length: MAX_IMAGES_PER_SLOT }, (_, j) => placeholderImageUrl(i + 1, j + 1)),
      ...defaultChips(slot),
    })),
    references: texts.references.map((r) => ({ images: [...r.images], line: r.line })),
    ...(texts.prePrompt ? { prePrompt: texts.prePrompt } : {}),
    ...(texts.trendPrompt ? { postPrompt: texts.trendPrompt } : {}),
    ...(overrides ? { overrides } : {}),
  }
}
