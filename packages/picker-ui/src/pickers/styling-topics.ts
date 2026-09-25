import { STYLING_DIMENSION_SECTIONS, type StylingDimensionSection } from "@nodaro/prompts"

export type StylingTopic = StylingDimensionSection

/**
 * The Styling picker's topics, in display order — @nodaro/prompts'
 * STYLING_DIMENSION_SECTIONS, the same list the API serves as the catalog's
 * `sections`. Each setting belongs to exactly one (styling-topics.test.ts and
 * the prompts-side guard fail the build otherwise), so the open view never
 * drops a setting.
 */
export const STYLING_TOPICS: ReadonlyArray<StylingTopic> = STYLING_DIMENSION_SECTIONS
