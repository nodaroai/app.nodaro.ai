import type { EntityKind } from "./types.js"

/** Build the `userPrompt` for a detail/wardrobe panel generated via the
 *  `custom` assetType (these boards have no dedicated backend assetType). */
export function buildPanelPrompt(entityKind: EntityKind, board: string, variant: string, name: string): string {
  if (board === "detail") {
    return `Extreme close-up macro detail of ${name}'s ${variant}, sharp focus on the ${variant}, neutral background, no text.`
  }
  if (board === "wardrobe") {
    return `Full-body view of ${name} wearing the "${variant}" outfit, consistent character, neutral studio background, no text.`
  }
  // Generic passthrough for any other custom board.
  return `${name}, ${variant}. Consistent character, neutral background, no text.`
}
