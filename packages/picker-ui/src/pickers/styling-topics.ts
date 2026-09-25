import type { StylingDimension } from "@nodaro/prompts"

export interface StylingTopic {
  readonly label: string
  readonly dimensions: ReadonlyArray<StylingDimension>
}

/**
 * The Styling picker's topics, in display order: each setting belongs to
 * exactly one (styling-topics.test.ts fails the build when a new dimension is
 * left out or listed twice), so the open view never drops a setting.
 */
export const STYLING_TOPICS: ReadonlyArray<StylingTopic> = [
  { label: "Beauty & Hair", dimensions: ["makeup", "hair-cut", "hair-treatment", "hair-state", "nails", "face-paint"] },
  { label: "Accessories", dimensions: ["eyewear", "headwear", "jewelry"] },
  { label: "Wardrobe", dimensions: ["outfit", "top", "bottom", "outerwear", "legwear", "footwear"] },
  { label: "Fabric & Fit", dimensions: ["fabric", "wardrobe-state"] },
]
