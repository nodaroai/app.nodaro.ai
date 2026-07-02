import { z } from "zod"

/**
 * Single source of truth for blueprint parameter schemas and metadata.
 *
 * A "blueprint" is a named, parameterised shot-shape (e.g. kinetic-type-beats,
 * cta-morph-press). This module declares:
 *   - BLUEPRINT_IDS   — readonly tuple of all known blueprint ids
 *   - BlueprintId     — union type derived from that tuple
 *   - BLUEPRINT_PARAM_SCHEMAS — per-id Zod schemas (satisfies Record<BlueprintId, …>)
 *   - BLUEPRINT_META  — per-id metadata (roles, defaultDurationFrames, description)
 *   - validateBlueprintParams — single-call validate helper
 *
 * Beat roles MUST match the vocabulary in backend/skills/video-director/doctrine.md:
 *   hook | pain_point | product_intro | feature_showcase | benefit_highlight |
 *   social_proof | branding | cta
 */

export const BLUEPRINT_IDS = [
  "comparison-split",
  "constellation-hub",
  "cta-morph-press",
  "dataviz-countup",
  "grid-card-assemble",
  "kinetic-type-beats",
  "logo-assemble-lockup",
  "overwhelm-surround",
  "spatial-pan-stations",
  "ticker-takeover",
  "titlecard-reveal",
  "typewriter-reveal",
  "waterfall-reveal",
] as const

export type BlueprintId = (typeof BLUEPRINT_IDS)[number]

/** Shared hex-color validator — accepts #RGB or #RRGGBB. */
const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color like #RRGGBB")

export const BLUEPRINT_PARAM_SCHEMAS = {
  /** Two labeled panels slide in from opposite sides; optional badges pop near the end. */
  "comparison-split": z.object({
    left: z.string().min(1),
    right: z.string().min(1),
    leftBadge: z.string().optional(),
    rightBadge: z.string().optional(),
    accentColor: hexColor.optional(),
  }),

  /** Labeled nodes spring into a ring around a center hub, then the shot resolves on the core. */
  "constellation-hub": z.object({
    hubLabel: z.string().min(1),
    nodes: z.array(z.object({ label: z.string().min(1) })).min(3).max(8),
    finisher: z.enum(["push-in", "orbit"]).optional(),
    accentColor: hexColor.optional(),
  }),

  /** A CTA button appears centred; a cursor decelerates in and presses it. */
  "cta-morph-press": z.object({
    label: z.string().min(1),
    sublabel: z.string().optional(),
    accentColor: hexColor.optional(),
  }),

  /** A big number counts up to a value with a label. */
  "dataviz-countup": z.object({
    value: z.number(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    label: z.string().min(1),
    sublabel: z.string().optional(),
    accentColor: hexColor.optional(),
  }),

  /** N text cards cascade-assemble into a grid with a staggered entrance. */
  "grid-card-assemble": z.object({
    items: z.array(z.object({ label: z.string().min(1) })).min(2).max(6),
    columns: z.number().int().min(1).max(4).optional(),
    accentColor: hexColor.optional(),
  }),

  /** 1–4 statement lines swap in by hard-cut/scale-pop; accent color for the payoff. */
  "kinetic-type-beats": z.object({
    lines: z.array(z.string().min(1)).min(1).max(4),
    accentColor: hexColor,
    bgColor: hexColor.optional(),
    invert: z.boolean().optional(),
  }),

  /** Brand word letters cascade/assemble into a centred lockup (+ optional tagline). */
  "logo-assemble-lockup": z.object({
    brand: z.string().min(1),
    tagline: z.string().optional(),
    accentColor: hexColor.optional(),
  }),

  /** Recognizable tool cards assemble, then demand bubbles close in from all sides on a revealed subject. */
  "overwhelm-surround": z.object({
    surfaces: z.array(z.object({ label: z.string().min(1) })).min(2).max(3),
    markers: z.array(z.string().min(1)).min(3).max(10),
    subjectLabel: z.string().min(1),
    demands: z.array(z.string().min(1)).min(4).max(10),
    accentColor: hexColor.optional(),
  }),

  /** Labeled stations on one oversized canvas, traversed by camera pans that center each in turn. */
  "spatial-pan-stations": z.object({
    stations: z
      .array(z.object({ label: z.string().min(1), sublabel: z.string().optional() }))
      .min(3)
      .max(6),
    variant: z.enum(["timeline", "web"]).optional(),
    accentColor: hexColor.optional(),
  }),

  /** A typed lead-in cycles an accent word, then a hero crashes in and shoves the text off-screen. */
  "ticker-takeover": z.object({
    leadIn: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(3),
    hero: z.string().min(1),
    accentColor: hexColor.optional(),
  }),

  /** One clean title (+ optional subtitle) revealed with one restrained move, then held. */
  "titlecard-reveal": z.object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    motion: z.enum(["slide-up", "crossfade", "wipe"]).optional(),
  }),

  /** Text types in character-by-character with a blinking caret; optional sublabel fades up after. */
  "typewriter-reveal": z.object({
    text: z.string().min(1),
    sublabel: z.string().optional(),
    accentColor: hexColor.optional(),
  }),

  /** Words of a line cut in one-by-one with a small horizontal slide, cascading left-to-right. */
  "waterfall-reveal": z.object({
    text: z.string().min(1),
    sublabel: z.string().optional(),
    accentColor: hexColor.optional(),
  }),
} satisfies Record<BlueprintId, z.ZodTypeAny>

/**
 * Beat roles use the vocabulary from backend/skills/video-director/doctrine.md:
 *   hook | pain_point | product_intro | feature_showcase | benefit_highlight |
 *   social_proof | branding | cta
 *
 * Reconciliation from the brief's draft roles:
 *   "problem"      → "pain_point"
 *   "feature"      → "feature_showcase"
 *   "benefits"     → "benefit_highlight"
 *   "benefit"      → "benefit_highlight"
 *   "breather"     → dropped (not in doctrine vocabulary)
 *   "product-intro"→ "product_intro" (hyphen → underscore)
 *   "outro"        → "branding" (brand lockup is a branding beat, not a separate arc beat)
 */
export const BLUEPRINT_META: Record<
  BlueprintId,
  { roles: string[]; defaultDurationFrames: number; description: string }
> = {
  "comparison-split": {
    roles: ["feature_showcase"],
    defaultDurationFrames: 180,
    description:
      "Two labeled panels slide in from opposite sides and hold side-by-side with a center divider; optional badges pop near the end.",
  },
  "constellation-hub": {
    roles: ["hook", "social_proof"],
    defaultDurationFrames: 180,
    description:
      "Labeled nodes spring into a ring around a center hub, then the shot resolves on the core — camera push-in (outer nodes blur) or partner badges orbiting the hub.",
  },
  "cta-morph-press": {
    roles: ["cta"],
    defaultDurationFrames: 150,
    description:
      "A CTA button appears centered; a cursor decelerates in and presses it with compression + ripple feedback.",
  },
  "dataviz-countup": {
    roles: ["pain_point"],
    defaultDurationFrames: 240,
    description:
      "A big number counts up to a value with a label; numbers are the hero.",
  },
  "grid-card-assemble": {
    roles: ["feature_showcase", "benefit_highlight", "social_proof"],
    defaultDurationFrames: 180,
    description:
      "N text cards cascade-assemble into a grid with a staggered entrance.",
  },
  "kinetic-type-beats": {
    roles: ["hook"],
    defaultDurationFrames: 150,
    description:
      "1–4 statement lines swap in by hard-cut/scale-pop; final line lands a spring-pop payoff on an accent.",
  },
  "logo-assemble-lockup": {
    roles: ["product_intro", "branding"],
    defaultDurationFrames: 180,
    description:
      "Brand word's letters cascade/assemble into a centered lockup (+ optional tagline).",
  },
  "overwhelm-surround": {
    roles: ["pain_point"],
    defaultDurationFrames: 210,
    description:
      "Recognizable tool cards assemble, density chips scatter in, the center card morphs to reveal the viewer, then demand bubbles close in from all sides — surrounded, not zoomed.",
  },
  "spatial-pan-stations": {
    roles: ["hook", "pain_point"],
    defaultDurationFrames: 240,
    description:
      "Labeled stations pre-placed on one oversized canvas, traversed by ease-in-out camera pans that center each station and pop a callout, landing held on the last.",
  },
  "ticker-takeover": {
    roles: ["hook", "branding"],
    defaultDurationFrames: 180,
    description:
      "A typed lead-in with an accent word cycling through options, then the hero crashes in from off-screen and physically shoves the text aside — a collision, not a fade.",
  },
  "titlecard-reveal": {
    roles: ["benefit_highlight", "social_proof"],
    defaultDurationFrames: 120,
    description:
      "One clean title (+ optional subtitle) revealed with one restrained move, then held.",
  },
  "typewriter-reveal": {
    roles: ["hook", "branding"],
    defaultDurationFrames: 180,
    description:
      "Text types in character-by-character with a blinking caret; optional sublabel fades up after typing finishes, then held.",
  },
  "waterfall-reveal": {
    roles: ["hook", "feature_showcase"],
    defaultDurationFrames: 150,
    description:
      "Words of a line cut in one-by-one with a small horizontal slide, cascading left-to-right; optional sublabel fades up after the last word lands.",
  },
}

/**
 * Validate params for a blueprint id.
 *
 * Returns `{ ok: true, data }` on success or `{ ok: false, message }` on failure.
 * An unknown id is treated as a validation failure (not a thrown error).
 */
export function validateBlueprintParams(
  id: string,
  params: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  const schema = (BLUEPRINT_PARAM_SCHEMAS as Record<string, z.ZodTypeAny>)[id]
  if (!schema) {
    return {
      ok: false,
      message: `Unknown blueprint id "${id}". Known: ${BLUEPRINT_IDS.join(", ")}`,
    }
  }
  const r = schema.safeParse(params)
  if (!r.success) {
    return {
      ok: false,
      message: r.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    }
  }
  return { ok: true, data: r.data as Record<string, unknown> }
}
